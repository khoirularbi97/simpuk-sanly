import bcrypt from 'bcryptjs';
import { Galat } from './config.js';
import { bacaTabel } from './iuran.js';

// Judul kolom yang dikenali, diperiksa berurutan dari yang paling khusus.
const KOLOM = [
  ['ke', /kontrak ?ke/],
  ['akhir', /(akhir|habis|selesai|berakhir).*kontrak|kontrak.*(akhir|habis|selesai|berakhir)/],
  ['gabung', /gabung|anggota sejak|masuk (puk|serikat)/],
  ['status', /keanggotaan|status ?anggota/],
  ['kar', /status ?(karyawan|kerja|pegawai)|jenis ?karyawan|^status$/],
  ['garda', /garda/],
  ['hp', /\bhp\b|telp|telepon|whats ?app|\bwa\b|ponsel|handphone/],
  ['mulai', /mulai|masuk ?kerja|tanggal masuk|tgl\.? ?masuk|join/],
  ['dept', /dep(ar)?t|bagian|divisi|seksi|section/],
  ['plant', /plant|pabrik|lokasi/],
  ['nik', /\bnik\b|nomor induk|no\.? ?(induk|karyawan|pegawai)|id ?karyawan/],
  ['nama', /nama/]
];
const LABEL_KOLOM = { nama: 'Nama', dept: 'Departemen', plant: 'Plant', hp: 'No. HP', kar: 'Status karyawan', ke: 'Kontrak ke', akhir: 'Akhir kontrak', mulai: 'Mulai bekerja', gabung: 'Tanggal gabung', status: 'Keanggotaan', garda: 'Garda Metal' };
const BLN = { jan: 1, januari: 1, feb: 2, februari: 2, mar: 3, maret: 3, apr: 4, april: 4, mei: 5, may: 5, jun: 6, juni: 6, jul: 7, juli: 7, agu: 8, agt: 8, agustus: 8, aug: 8, sep: 9, september: 9, okt: 10, oktober: 10, oct: 10, nov: 11, november: 11, des: 12, desember: 12, dec: 12 };

const kosong = (v) => v == null || String(v).trim() === '';
const teks = (v) => String(v ?? '').trim();

// Tanggal dari sel Excel (Date atau nomor seri) atau teks 2024-03-18, 18/03/2024, 18-03-24, 18 Maret 2024.
function tanggal(v) {
  let y, m, d;
  if (v instanceof Date) { if (Number.isNaN(v.getTime())) return null; y = v.getUTCFullYear(); m = v.getUTCMonth() + 1; d = v.getUTCDate(); }
  else if (typeof v === 'number') { const x = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000); y = x.getUTCFullYear(); m = x.getUTCMonth() + 1; d = x.getUTCDate(); }
  else {
    const s = teks(v).toLowerCase(); let r;
    if ((r = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) [y, m, d] = [+r[1], +r[2], +r[3]];
    else if ((r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s))) [d, m, y] = [+r[1], +r[2], +r[3]];
    else if ((r = /^(\d{1,2})[\s-]+([a-z]+)\.?[\s-]+(\d{2,4})$/.exec(s)) && BLN[r[2]]) [d, m, y] = [+r[1], BLN[r[2]], +r[3]];
    else return null;
    if (y < 100) y += 2000;
  }
  const x = new Date(Date.UTC(y, m - 1, d));
  if (x.getUTCFullYear() !== y || x.getUTCMonth() !== m - 1 || x.getUTCDate() !== d || y < 1950 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function statusKaryawan(v) {
  const s = teks(v).toLowerCase();
  if (/pkwtt|tetap|permanen/.test(s)) return { kar: 'pkwtt' };
  if (/pkwt|kontrak/.test(s)) { const n = /(\d+)/.exec(s); return { kar: 'pkwt', ke: n ? Number(n[1]) : null }; }
  return null;
}
function keanggotaan(v) {
  const s = teks(v).toLowerCase().replace(/\s+/g, ' ');
  if (/^(non ?aktif|tidak aktif|nonaktif)/.test(s)) return 'nonaktif';
  if (/^(keluar|resign|berhenti|mengundurkan)/.test(s)) return 'keluar';
  if (/^aktif/.test(s)) return 'aktif';
  return null;
}
function yaTidak(v) {
  const s = teks(v).toLowerCase();
  if (/^(ya|y|yes|1|true|v|✓|garda)/.test(s)) return true;
  if (/^(tidak|tdk|t|no|n|0|false|-|bukan)/.test(s)) return false;
  return null;
}

// Membaca file, mencocokkan dengan data anggota, lalu (bila simpan) menambah dan memperbarui anggota.
// Peran, sandi, nomor KTA, dan korlap tidak pernah diubah lewat impor.
export async function imporAnggota(db, file, simpan) {
  const tabel = await bacaTabel(file, 'Pilih file data anggota terlebih dahulu.');
  let kol = null, mulai = 0;
  for (let i = 0; i < Math.min(tabel.length, 15); i++) {
    const peta = {};
    tabel[i].forEach((c, j) => {
      const s = teks(c).toLowerCase();
      if (!s) return;
      const k = KOLOM.find(([kunci, re]) => !(kunci in peta) && re.test(s));
      if (k) peta[k[0]] = j;
    });
    if ('nik' in peta && 'nama' in peta) { kol = peta; mulai = i + 1; break; }
  }
  if (!kol) throw new Galat('Baris judul tidak ditemukan. Pastikan ada kolom berjudul NIK dan Nama, atau pakai templat.');
  const data = tabel.slice(mulai);
  if (data.length > 3000) throw new Galat('Maksimal 3.000 baris per file. Bagi file menjadi beberapa bagian.');

  const ada = new Map((await db.query(
    `SELECT nik, nama, departemen AS dept, plant, no_hp AS hp, status_karyawan AS kar, kontrak_ke AS ke, COALESCE(akhir_kontrak::text, '') AS akhir,
     mulai_kerja AS mulai, tanggal_gabung AS gabung, status, garda FROM anggota`
  )).rows.map((a) => [a.nik, a]));

  const hasil = { kolom: Object.keys(kol).filter((k) => k !== 'nik').map((k) => LABEL_KOLOM[k]), baru: [], diperbarui: [], tetap: 0, galat: [] };
  const siap = [], dilihat = new Set();
  data.forEach((b, j) => {
    const baris = mulai + j + 1;   // nomor baris seperti terlihat di Excel
    const sel = (k) => (k in kol ? b[kol[k]] : undefined);
    if (b.every(kosong)) return;
    const nik = teks(sel('nik')).replace(/\.0+$/, '').replace(/\s/g, '');
    const salah = (pesan) => hasil.galat.push({ baris, nik, nama: teks(sel('nama')), pesan });
    if (!nik) { if (!kosong(sel('nama'))) salah('NIK kosong.'); return; }
    if (/^contoh/i.test(nik)) return;   // baris contoh dari templat
    if (!/^\d{6,20}$/.test(nik)) { if (/^\d|nik/i.test(nik) || !kosong(sel('nama'))) salah('NIK harus berupa 6 sampai 20 angka.'); return; }
    if (dilihat.has(nik)) { salah('NIK muncul lebih dari sekali di file ini. Baris ini dilewati.'); return; }
    dilihat.add(nik);

    const lama = ada.get(nik);
    const r = lama ? { ...lama, akhir: lama.akhir || '' } : { nik, nama: '', dept: '', plant: '', hp: '', kar: '', ke: null, akhir: '', mulai: '', gabung: '', status: 'aktif', garda: false };
    try {
      if (!kosong(sel('nama'))) r.nama = teks(sel('nama')).slice(0, 150);
      if (!kosong(sel('dept'))) r.dept = teks(sel('dept')).slice(0, 100);
      if (!kosong(sel('plant'))) r.plant = teks(sel('plant')).slice(0, 50);
      if (!kosong(sel('hp'))) r.hp = teks(sel('hp')).replace(/\.0+$/, '').slice(0, 30);
      if (!kosong(sel('kar'))) {
        const s = statusKaryawan(sel('kar'));
        if (!s) throw new Error(`Status karyawan "${teks(sel('kar'))}" tidak dikenal. Isi PKWT atau PKWTT.`);
        if (s.kar !== r.kar) { r.ke = null; r.akhir = ''; }
        r.kar = s.kar;
        if (s.ke) r.ke = s.ke;
      }
      if (!kosong(sel('ke'))) { const n = Number(teks(sel('ke')).replace(/\D/g, '')); if (!Number.isInteger(n) || n < 1) throw new Error('Kontrak ke harus angka 1 atau lebih.'); r.ke = n; }
      for (const k of ['akhir', 'mulai', 'gabung']) {
        if (kosong(sel(k))) continue;
        const t = tanggal(sel(k));
        if (!t) throw new Error(`${LABEL_KOLOM[k]} "${teks(sel(k))}" bukan tanggal yang dikenali. Pakai format 31/12/2026.`);
        r[k] = t;
      }
      if (!kosong(sel('status'))) { const s = keanggotaan(sel('status')); if (!s) throw new Error(`Keanggotaan "${teks(sel('status'))}" tidak dikenal. Isi Aktif, Nonaktif, atau Keluar.`); r.status = s; }
      if (!kosong(sel('garda'))) { const g = yaTidak(sel('garda')); if (g == null) throw new Error('Garda Metal diisi Ya atau Tidak.'); r.garda = g; }

      const kurang = ['nama', 'dept', 'plant', 'kar', 'mulai'].filter((k) => !r[k]).map((k) => LABEL_KOLOM[k]);
      if (kurang.length) throw new Error(`${kurang.join(', ')} wajib diisi untuk anggota baru.`);
      if (!r.gabung) r.gabung = r.mulai;
      if (r.kar === 'pkwtt') { r.ke = null; r.akhir = ''; }
      else {
        if (!r.ke) throw new Error('Untuk PKWT, isi kolom Kontrak ke (1, 2, 3, dst.).');
        if (r.akhir && r.akhir < r.mulai) throw new Error('Akhir kontrak lebih awal dari tanggal mulai bekerja.');
      }
    } catch (e) { salah(e.message); return; }

    if (!lama) { hasil.baru.push({ nik, nama: r.nama, dept: r.dept, plant: r.plant, kar: r.kar, ke: r.ke }); siap.push(r); return; }
    const berubah = Object.keys(LABEL_KOLOM).filter((k) => String(lama[k] ?? '') !== String(r[k] ?? '')).map((k) => LABEL_KOLOM[k]);
    if (!berubah.length) { hasil.tetap++; return; }
    hasil.diperbarui.push({ nik, nama: r.nama, kolom: berubah });
    r.ubah = true; r.keluarAktif = lama.status === 'aktif' && r.status !== 'aktif';
    siap.push(r);
  });

  if (simpan && siap.length) {
    const hash = siap.some((r) => !r.ubah) ? await bcrypt.hash(process.env.SANDI_AWAL, 10) : '';
    for (const r of siap) {
      const isi = [r.nik, r.nama, r.dept, r.plant, r.hp, r.kar, r.ke, r.akhir || null, r.mulai, r.gabung, r.status, r.garda];
      if (r.ubah) {
        await db.query(`UPDATE anggota SET nama = $2, departemen = $3, plant = $4, no_hp = $5, status_karyawan = $6, kontrak_ke = $7, akhir_kontrak = $8,
          mulai_kerja = $9, tanggal_gabung = $10, status = $11, garda = $12 WHERE nik = $1`, isi);
        if (r.keluarAktif) {   // sama seperti form: anggota yang tidak aktif dilepas dari struktur korlap
          await db.query('UPDATE anggota SET korlap_nik = NULL WHERE korlap_nik = $1', [r.nik]);
          await db.query('UPDATE anggota SET is_korlap = FALSE, korlap_nik = NULL WHERE nik = $1', [r.nik]);
        }
      } else {
        await db.query(`INSERT INTO anggota (nik, nama, departemen, plant, no_hp, status_karyawan, kontrak_ke, akhir_kontrak, mulai_kerja, tanggal_gabung, status, garda, no_kta, sandi_hash)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'KTA-' || lpad(nextval('kta_seq')::text, 4, '0'), $13)`, [...isi, hash]);
      }
    }
  }
  for (const k of ['baru', 'diperbarui', 'galat']) { hasil['jumlah' + k[0].toUpperCase() + k.slice(1)] = hasil[k].length; hasil[k] = hasil[k].slice(0, 500); }
  return hasil;
}
