import fs from 'node:fs';
import bcrypt from 'bcryptjs';

for (const k of ['DATABASE_URL', 'JWT_SECRET', 'SANDI_AWAL']) {
  if (!process.env[k]) { console.error(`Variabel lingkungan ${k} belum diisi. Lihat server/.env.example.`); process.exit(1); }
}
if (process.env.SANDI_AWAL.length < 8) { console.error('SANDI_AWAL minimal 8 karakter.'); process.exit(1); }

const { pool } = await import('./db.js');
const { app } = await import('./app.js');

// Skema dijalankan setiap kali server mulai; semua perintahnya aman diulang.
await pool.query(fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));

// Akun Sekretaris (admin) pertama dibuat dari ADMIN_NIK dan ADMIN_NAMA bila belum ada admin sama sekali.
const adaAdmin = (await pool.query("SELECT 1 FROM anggota WHERE peran = 'admin' LIMIT 1")).rowCount;
if (!adaAdmin && process.env.ADMIN_NIK) {
  await pool.query(
    `INSERT INTO anggota (nik, nama, status_karyawan, mulai_kerja, tanggal_gabung, no_kta, peran, sandi_hash)
     VALUES ($1, $2, 'pkwtt', hari_ini(), hari_ini(), 'KTA-' || lpad(nextval('kta_seq')::text, 4, '0'), 'admin', $3)
     ON CONFLICT (nik) DO UPDATE SET peran = 'admin'`,
    [process.env.ADMIN_NIK, process.env.ADMIN_NAMA || 'Sekretaris PUK', await bcrypt.hash(process.env.SANDI_AWAL, 10)]
  );
  console.log(`Akun admin dibuat untuk NIK ${process.env.ADMIN_NIK}. Masuk dengan SANDI_AWAL lalu ganti sandinya.`);
}

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`SIMPUK API berjalan di port ${port}`));
