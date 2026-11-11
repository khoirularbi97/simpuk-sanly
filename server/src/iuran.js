import readXlsxFile from 'read-excel-file/node';
import { Galat, rp } from './config.js';

function angka(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').replace(/rp/i, '').replace(/\s/g, '');
  if (!s) return NaN;
  if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');   // 48.000,00
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');                      // 48.000
  else if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '');                        // 48,000
  else s = s.replace(',', '.');
  return Number(s);
}

function bacaCsv(teks) {
  const baris = teks.replace(/^﻿/, '').split(/\r?\n/).filter((b) => b.trim());
  const pemisah = (baris[0] || '').split(';').length > (baris[0] || '').split(',').length ? ';' : ',';
  return baris.map((b) => {
    const sel = []; let kini = '', kutip = false;
    for (const ch of b) {
      if (ch === '"') kutip = !kutip;
      else if (ch === pemisah && !kutip) { sel.push(kini); kini = ''; }
      else kini += ch;
    }
    sel.push(kini);
    return sel.map((s) => s.trim());
  });
}

// Membaca sheet pertama file .xlsx atau .csv menjadi tabel baris dan kolom.
export async function bacaTabel(file, pesanKosong = 'Pilih file terlebih dahulu.') {
  if (!file) throw new Galat(pesanKosong);
  const nama = file.originalname.toLowerCase();
  try {
    if (nama.endsWith('.csv')) return bacaCsv(file.buffer.toString('utf8')).filter((b) => !/^sep=/i.test(b[0] || ''));
    if (nama.endsWith('.xlsx')) return ((await readXlsxFile(file.buffer))[0] || { data: [] }).data;   // sheet pertama
  } catch {
    throw new Galat('File tidak bisa dibaca. Pastikan berupa Excel (.xlsx) atau CSV yang tidak rusak.');
  }
  throw new Galat('Format file harus .xlsx atau .csv.');
}

// Membaca rekap potongan dari HR (.xlsx atau .csv) menjadi [{ nik, nama, nominal, ket }].
// Kolom dikenali dari judulnya: NIK, Nama, dan Nominal/Potongan/Iuran/Jumlah. Tanpa judul: kolom 1, 2, 3.
export async function bacaRekap(file) {
  const tabel = await bacaTabel(file, 'Pilih file rekap terlebih dahulu.');
  let kNik = 0, kNama = 1, kNom = 2, mulai = 0;
  for (let i = 0; i < Math.min(tabel.length, 15); i++) {
    const j = tabel[i].map((c) => String(c ?? '').toLowerCase());
    const n = j.findIndex((c) => /\bnik\b|nomor induk|no\.? ?karyawan/.test(c));
    if (n < 0) continue;
    const nm = j.findIndex((c) => /nama/.test(c));
    const nom = j.findIndex((c) => /nominal|potongan|iuran|jumlah|amount/.test(c));
    if (nom < 0) throw new Galat('Kolom nominal potongan tidak ditemukan. Beri judul kolom "Nominal" atau "Potongan".');
    kNik = n; kNama = nm; kNom = nom; mulai = i + 1;
    break;
  }
  const peta = new Map();
  for (const b of tabel.slice(mulai)) {
    const nik = String(b[kNik] ?? '').trim().replace(/\.0+$/, '');
    if (!/^\d{6,20}$/.test(nik)) continue;                       // baris total, kosong, atau catatan dilewati
    const nominal = angka(b[kNom]);
    if (!Number.isFinite(nominal) || nominal < 0) throw new Galat(`Nominal untuk NIK ${nik} tidak bisa dibaca.`);
    const lama = peta.get(nik);
    if (lama) { lama.nominal += nominal; lama.ket = 'NIK muncul lebih dari sekali di file, nominal dijumlahkan'; }
    else peta.set(nik, { nik, nama: kNama >= 0 ? String(b[kNama] ?? '').trim() : '', nominal, ket: '' });
  }
  if (!peta.size) throw new Galat('Tidak ada baris dengan NIK yang valid di file ini.');
  return [...peta.values()];
}

// Mencocokkan baris HR pada satu periode dengan data anggota, lalu menandai selisihnya.
export async function cocokkan(db, periodeId, catatanLama) {
  const p = (await db.query('SELECT tahun, bulan FROM periode_iuran WHERE id = $1', [periodeId])).rows[0];
  const lama = catatanLama || new Map((await db.query("SELECT nik_hr, catatan FROM iuran WHERE periode_id = $1 AND catatan <> ''", [periodeId])).rows.map((r) => [r.nik_hr, r.catatan]));
  await db.query('DELETE FROM iuran WHERE periode_id = $1 AND NOT dari_hr', [periodeId]);

  const prev = (await db.query("SELECT id FROM periode_iuran WHERE status = 'terkunci' AND (tahun, bulan) < ($1, $2) ORDER BY tahun DESC, bulan DESC LIMIT 1", [p.tahun, p.bulan])).rows[0];
  const sebelum = new Map(prev ? (await db.query('SELECT nik_hr, nominal FROM iuran WHERE periode_id = $1 AND dari_hr', [prev.id])).rows.map((r) => [r.nik_hr, r.nominal]) : []);
  const anggota = new Map((await db.query(
    "SELECT nik, nama, status, tanggal_gabung <= (make_date($1, $2, 1) + interval '1 month' - interval '1 day')::date AS sudah FROM anggota", [p.tahun, p.bulan]
  )).rows.map((a) => [a.nik, a]));
  const rows = (await db.query('SELECT id, nik_hr, nominal, ket_impor FROM iuran WHERE periode_id = $1 AND dari_hr', [periodeId])).rows;

  const ids = [], sts = [], kets = [], ada = new Set();
  for (const r of rows) {
    ada.add(r.nik_hr);
    const a = anggota.get(r.nik_hr), s = sebelum.get(r.nik_hr);
    let st = 'cocok', ket = '';
    if (!a) { st = 'bukan_anggota'; ket = 'NIK tidak ada di data anggota'; }
    else if (a.status !== 'aktif') { st = 'anggota_tidak_aktif'; ket = 'Keanggotaan: ' + a.status; }
    else if (r.ket_impor) { st = 'anomali'; ket = r.ket_impor; }
    else if (r.nominal === 0) { st = 'anomali'; ket = 'Nominal nol'; }
    else if (s && Math.abs(r.nominal - s) / s > 0.5) { st = 'anomali'; ket = `Berubah lebih dari 50% dari periode sebelumnya (${rp(s)})`; }
    ids.push(r.id); sts.push(st); kets.push(ket);
  }
  if (ids.length) await db.query('UPDATE iuran i SET status = d.s, ket = d.k FROM unnest($1::int[], $2::text[], $3::text[]) AS d(id, s, k) WHERE i.id = d.id', [ids, sts, kets]);

  const tanpa = [...anggota.values()].filter((a) => a.status === 'aktif' && a.sudah && !ada.has(a.nik));
  if (tanpa.length) await db.query(
    "INSERT INTO iuran (periode_id, nik_hr, nama_hr, nominal, dari_hr, status, ket, catatan) SELECT $1, d.nik, d.nama, NULL, FALSE, 'tidak_terpotong', 'Anggota aktif, tidak ada di rekap HR', d.cat FROM unnest($2::text[], $3::text[], $4::text[]) AS d(nik, nama, cat)",
    [periodeId, tanpa.map((a) => a.nik), tanpa.map((a) => a.nama), tanpa.map((a) => lama.get(a.nik) || '')]
  );
}
