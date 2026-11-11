import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool, tx } from './db.js';
import { LABEL, Galat, boleh, namaPeriode } from './config.js';
import { bootstrap } from './bootstrap.js';
import { AKSI } from './aksi.js';
import { bacaRekap, cocokkan } from './iuran.js';
import { imporAnggota } from './anggota-impor.js';

const RAHASIA = process.env.JWT_SECRET;
const h = (fn) => (req, res, next) => fn(req, res).catch(next);

export const app = express();
app.set('trust proxy', 1);
app.use(helmet());
const asal = (process.env.FRONTEND_URL || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
app.use(cors({ origin: asal.length ? asal : true }));
app.use(express.json({ limit: '200kb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---------- Login ----------
const batasLogin = rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.BATAS_LOGIN || 20), standardHeaders: true, legacyHeaders: false, message: { pesan: 'Terlalu banyak percobaan masuk. Coba lagi 15 menit lagi.' } });
app.post('/api/login', batasLogin, h(async (req, res) => {
  const nik = String(req.body.nik ?? '').trim(), sandi = String(req.body.sandi ?? '');
  const a = (await pool.query('SELECT nik, sandi_hash, status FROM anggota WHERE nik = $1', [nik])).rows[0];
  if (!a || !(await bcrypt.compare(sandi, a.sandi_hash))) throw new Galat('NIK atau sandi salah.', 401);
  if (a.status !== 'aktif') throw new Galat('Keanggotaan NIK ini sudah tidak aktif. Hubungi pengurus.', 403);
  await pool.query("INSERT INTO log_aktivitas (nik, oleh, teks) SELECT nik, nama, 'Masuk ke sistem' FROM anggota WHERE nik = $1", [nik]);
  res.json({ token: jwt.sign({ nik }, RAHASIA, { expiresIn: '12h' }) });
}));

// ---------- Wajib login untuk semua rute di bawah ----------
const auth = (req, res, next) => (async () => {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  let nik;
  try { nik = jwt.verify(t, RAHASIA).nik; } catch { throw new Galat('Sesi berakhir. Silakan masuk lagi.', 401); }
  const u = (await pool.query('SELECT nik, nama, peran, status, garda, is_korlap, wajib_ganti FROM anggota WHERE nik = $1', [nik])).rows[0];
  if (!u || u.status !== 'aktif') throw new Galat('Sesi berakhir. Silakan masuk lagi.', 401);
  if (!LABEL[u.peran]) u.peran = 'anggota';
  req.u = u;
})().then(() => next(), next);

const konteks = (db, u) => ({
  db, u,
  izin(kunci) { if (!boleh(u.peran, kunci)) throw new Galat('Peran Anda tidak diizinkan melakukan ini.', 403); },
  log(teks) { return db.query('INSERT INTO log_aktivitas (nik, oleh, teks) VALUES ($1, $2, $3)', [u.nik, `${u.nama} (${LABEL[u.peran]})`, teks]); }
});

app.get('/api/bootstrap', auth, h(async (req, res) => {
  res.json(await bootstrap(pool, req.u, String(req.query.p || '')));
}));

app.post('/api/aksi/:nama', auth, h(async (req, res) => {
  const fn = Object.hasOwn(AKSI, req.params.nama) ? AKSI[req.params.nama] : null;
  if (!fn) throw new Galat('Aksi tidak dikenal.', 404);
  if (req.u.wajib_ganti && req.params.nama !== 'sandi-ganti') throw new Galat('Ganti sandi awal Anda terlebih dahulu.', 403);
  await tx((db) => fn(konteks(db, req.u), req.body || {}));
  res.json({ ok: true });
}));

// Impor rekap potongan iuran dari HR (multipart: file, periode=YYYY-MM).
const unggah = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
app.post('/api/iuran/impor', auth, unggah.single('file'), h(async (req, res) => {
  if (req.u.wajib_ganti) throw new Galat('Ganti sandi awal Anda terlebih dahulu.', 403);
  const m = /^(\d{4})-(\d{2})$/.exec(String(req.body.periode || ''));
  const tahun = m ? Number(m[1]) : 0, bulan = m ? Number(m[2]) : 0;
  if (!m || bulan < 1 || bulan > 12 || tahun < 2000 || tahun > 2100) throw new Galat('Pilih periode (bulan dan tahun) terlebih dahulu.');
  const rows = await bacaRekap(req.file);
  await tx(async (db) => {
    const c = konteks(db, req.u);
    c.izin('iuranKelola');
    let p = (await db.query('SELECT id, status FROM periode_iuran WHERE tahun = $1 AND bulan = $2 FOR UPDATE', [tahun, bulan])).rows[0];
    if (p && p.status === 'terkunci') throw new Galat(`Periode ${namaPeriode(tahun, bulan)} sudah dikunci dan tidak bisa diimpor ulang.`);
    const ulang = !!p;
    const nama = String(req.file.originalname).slice(0, 200);
    if (p) await db.query('UPDATE periode_iuran SET nama_file = $1, diimpor_pada = now() WHERE id = $2', [nama, p.id]);
    else p = (await db.query('INSERT INTO periode_iuran (tahun, bulan, nama_file) VALUES ($1, $2, $3) RETURNING id', [tahun, bulan, nama])).rows[0];
    const lama = new Map((await db.query("SELECT nik_hr, catatan FROM iuran WHERE periode_id = $1 AND catatan <> ''", [p.id])).rows.map((r) => [r.nik_hr, r.catatan]));
    await db.query('DELETE FROM iuran WHERE periode_id = $1', [p.id]);
    await db.query(
      'INSERT INTO iuran (periode_id, nik_hr, nama_hr, nominal, ket_impor, catatan) SELECT $1, d.nik, d.nama, d.nominal, d.ket, d.cat FROM unnest($2::text[], $3::text[], $4::numeric[], $5::text[], $6::text[]) AS d(nik, nama, nominal, ket, cat)',
      [p.id, rows.map((r) => r.nik), rows.map((r) => r.nama), rows.map((r) => r.nominal), rows.map((r) => r.ket), rows.map((r) => lama.get(r.nik) || '')]
    );
    await cocokkan(db, p.id, lama);
    await c.log(`${ulang ? 'Mengimpor ulang' : 'Mengimpor'} rekap iuran ${namaPeriode(tahun, bulan)} (${rows.length} baris)`);
  });
  res.json({ ok: true, periode: m[0] });
}));

// Impor data anggota dari Excel (multipart: file, simpan=1). Tanpa simpan=1 hanya memeriksa dan mengembalikan pratinjau.
app.post('/api/anggota/impor', auth, unggah.single('file'), h(async (req, res) => {
  if (req.u.wajib_ganti) throw new Galat('Ganti sandi awal Anda terlebih dahulu.', 403);
  const simpan = req.body.simpan === '1';
  const hasil = await tx(async (db) => {
    const c = konteks(db, req.u);
    c.izin('anggotaUbah');
    if (simpan) await db.query('SELECT pg_advisory_xact_lock(7302)');
    const r = await imporAnggota(db, req.file, simpan);
    if (simpan && (r.jumlahBaru || r.jumlahDiperbarui)) await c.log(`Mengimpor data anggota dari ${String(req.file.originalname).slice(0, 120)}: ${r.jumlahBaru} baru, ${r.jumlahDiperbarui} diperbarui`);
    return r;
  });
  res.json({ ...hasil, disimpan: simpan });
}));

app.use((req, res) => res.status(404).json({ pesan: 'Alamat tidak ditemukan.' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof Galat) return res.status(err.status).json({ pesan: err.message });
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ pesan: 'Ukuran file maksimal 5 MB.' });
  console.error(err);
  res.status(500).json({ pesan: 'Terjadi kesalahan di server. Coba lagi sebentar lagi.' });
});
