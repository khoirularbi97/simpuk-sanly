// Mengisi database dengan data CONTOH (nama dan angka fiktif) untuk mencoba aplikasi.
// Jangan dijalankan di database yang sudah berisi data nyata: skrip berhenti bila tabel anggota sudah berisi lebih dari satu baris.
// Pakai: DATABASE_URL=... SANDI_AWAL=... npm run seed:demo
import fs from 'node:fs';
import bcrypt from 'bcryptjs';

const { pool, tx } = await import('../src/db.js');
await pool.query(fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
if ((await pool.query('SELECT COUNT(*) AS n FROM anggota')).rows[0].n > 1) { console.error('Tabel anggota sudah berisi data. Dibatalkan.'); process.exit(1); }

const hari = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
// nik, nama, dept, plant, korlap, status karyawan, kontrak ke, akhir kontrak, mulai kerja, gabung, keanggotaan, peran, korlap?, garda?
const A = [
  ['20160421', 'Bambang Irawan', 'Painting', 'Plant 1', null, 'pkwtt', null, null, '2016-04-18', '2016-08-01', 'aktif', 'ketua', true, false],
  ['20150310', 'Slamet Riyadi', 'Injection', 'Plant 2', null, 'pkwtt', null, null, '2015-03-09', '2015-06-01', 'aktif', 'bendahara', true, false],
  ['20180915', 'Eko Susanto', 'Gudang', 'Plant 3', null, 'pkwtt', null, null, '2018-09-10', '2019-01-07', 'aktif', 'admin', true, false],
  ['20250107', 'Rina Marlina', 'Injection', 'Plant 1', '20160421', 'pkwt', 1, hari(4), '2025-01-06', '2025-04-01', 'aktif', 'anggota', false, false],
  ['20231122', 'Yoga Pratama', 'Assembly', 'Plant 1', '20160421', 'pkwt', 3, hari(11), '2023-11-20', '2024-02-01', 'aktif', 'anggota', false, true],
  ['20190452', 'Siti Aminah', 'Quality Control', 'Plant 2', '20150310', 'pkwtt', null, null, '2019-09-02', '2019-12-02', 'aktif', 'hukum', false, false],
  ['20240318', 'Fajar Setiawan', 'Painting', 'Plant 2', '20150310', 'pkwt', 2, hari(-5), '2024-03-18', '2024-06-03', 'aktif', 'anggota', false, false],
  ['20240902', 'Nur Hidayah', 'Gudang', 'Plant 3', '20180915', 'pkwt', 2, hari(20), '2024-09-02', '2024-12-02', 'aktif', 'anggota', false, false],
  ['20170238', 'Agus Salim', 'Maintenance', 'Plant 3', null, 'pkwtt', null, null, '2017-02-13', '2017-05-02', 'keluar', 'anggota', false, false],
  ['20220671', 'Wahyu Nugroho', 'Assembly', 'Plant 1', '20160421', 'pkwtt', null, null, '2022-06-06', '2022-09-05', 'aktif', 'anggota', false, true],
  ['20231187', 'Rudi Hartono', 'Painting', 'Plant 2', '20230605', 'pkwt', 3, hari(75), '2023-11-06', '2024-02-05', 'aktif', 'anggota', false, false],
  ['20250615', 'Andi Saputra', 'Injection', 'Plant 2', '20230605', 'pkwt', 1, hari(28), '2025-06-16', '2025-09-01', 'aktif', 'anggota', false, false],
  ['20200733', 'Dewi Lestari', 'Quality Control', 'Plant 1', '20160421', 'pkwtt', null, null, '2020-07-13', '2020-10-05', 'aktif', 'organisasi', false, false],
  ['20210209', 'Hendra Gunawan', 'Maintenance', 'Plant 1', '20160421', 'pkwtt', null, null, '2021-02-08', '2021-05-03', 'aktif', 'pendidikan', false, true],
  ['20220118', 'Sri Wahyuni', 'Assembly', 'Plant 3', '20180915', 'pkwtt', null, null, '2022-01-17', '2022-04-04', 'aktif', 'kesos', false, false],
  ['20241014', 'Imam Maulana', 'Gudang', 'Plant 3', '20180915', 'pkwt', 2, hari(140), '2024-10-14', '2025-01-06', 'aktif', 'anggota', false, true],
  ['20190826', 'Tri Handoko', 'Painting', 'Plant 1', '20160421', 'pkwtt', null, null, '2019-08-26', '2019-11-04', 'aktif', 'pkb', false, false],
  ['20230605', 'Lina Kartika', 'Injection', 'Plant 2', '20150310', 'pkwtt', null, null, '2023-06-05', '2023-09-04', 'aktif', 'anggota', true, false]
];

const hash = await bcrypt.hash(process.env.SANDI_AWAL || 'gantisaya123', 10);
await tx(async (db) => {
  await db.query('DELETE FROM anggota');
  for (const a of A) {
    await db.query(
      `INSERT INTO anggota (nik, nama, departemen, plant, status_karyawan, kontrak_ke, akhir_kontrak, mulai_kerja, tanggal_gabung, status, peran, is_korlap, garda, no_kta, sandi_hash, wajib_ganti)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'KTA-' || lpad(nextval('kta_seq')::text, 4, '0'), $14, FALSE)`,
      [a[0], a[1], a[2], a[3], a[5], a[6], a[7], a[8], a[9], a[10], a[11], a[12], a[13], hash]
    );
  }
  for (const a of A) if (a[4]) await db.query('UPDATE anggota SET korlap_nik = $1 WHERE nik = $2', [a[4], a[0]]);
  await db.query("INSERT INTO pengumuman (judul, isi, oleh) VALUES ('Rapat anggota bulanan', E'Rapat anggota diadakan Sabtu ini pukul 09.00 di sekretariat PUK.\\nAgenda: laporan kas, perkembangan perundingan PKB, dan tanya jawab.', 'Bambang Irawan')");
  await db.query("INSERT INTO kas (tanggal, jenis, kategori, keterangan, nominal, oleh) VALUES (hari_ini() - 40, 'masuk', 'Iuran', 'Saldo awal contoh', 2500000, 'Slamet Riyadi'), (hari_ini() - 20, 'keluar', 'Rapat', 'Konsumsi rapat anggota', 350000, 'Slamet Riyadi')");
  await db.query("INSERT INTO aduan (nik, kategori, judul, isi) VALUES ('20250107', 'Lembur', 'Lembur bulan lalu belum dibayar penuh', 'Lembur dua hari Sabtu belum masuk di slip gaji.')");
  await db.query("INSERT INTO diklat (judul, tanggal, tempat, kuota) VALUES ('Pendidikan dasar ketenagakerjaan', hari_ini() + 10, 'Sekretariat PUK', 20)");
  await db.query("INSERT INTO pkb (pasal, usulan, status) VALUES ('Perpanjangan kontrak PKWT', 'Pemberitahuan perpanjangan atau pengakhiran kontrak paling lambat 14 hari sebelum kontrak berakhir.', 'diusulkan')");
  await db.query("INSERT INTO kampanye (judul, target) VALUES ('Dana solidaritas anggota terdampak banjir', 3000000)");
  await db.query("INSERT INTO surat_masuk (nomor, pengirim, perihal, tanggal) VALUES ('045/PC-FSPMI/XI/2026', 'PC FSPMI', 'Undangan rapat koordinasi PUK', hari_ini() - 3)");
  await db.query("INSERT INTO instruksi (judul, isi, oleh) VALUES ('Sosialisasi rapat anggota', 'Sampaikan undangan rapat anggota bulanan ke basis masing-masing.', 'Dewi Lestari')");
  await db.query("INSERT INTO tugas_garda (judul, jenis, tanggal, lokasi, butuh) VALUES ('Pengamanan rapat anggota bulanan', 'Pengamanan rapat', hari_ini() + 3, 'Sekretariat PUK', 3)");
});
console.log(`Data contoh dimasukkan: ${A.length} anggota. Semua akun memakai sandi dari SANDI_AWAL.`);
await pool.end();
