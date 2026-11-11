# SIMPUK

Sistem Informasi dan Manajemen Anggota PUK SPAMK FSPMI PT. Sanly Industries.

| Bagian | Teknologi | Tempat deploy |
|---|---|---|
| `client/` | Vite, JavaScript tanpa framework | Vercel |
| `server/` | Node.js, Express | Render |
| Database | PostgreSQL | Neon |

## Isi aplikasi

- **Login** dengan NIK dan sandi. Akun baru wajib mengganti sandi awal sebelum bisa membuka menu lain.
- **Peran:** Sekretaris (Admin), Ketua, Bendahara, Waka Hukum & Advokasi, Waka Organisasi & Infokom, Waka Pendidikan, Waka Pengupahan & PKB, Waka Kesejahteraan Sosial, dan Anggota. Hak akses diperiksa di server, bukan hanya disembunyikan di tampilan.
- **Data anggota:** status PKWT/PKWTT, kontrak ke berapa, akhir kontrak, nomor KTA otomatis, dan KTA digital dengan kode QR.
- **Impor anggota dari Excel** (.xlsx atau .csv): pratinjau dulu (anggota baru, yang diperbarui beserta kolomnya, dan baris yang salah beserta alasannya), baru disimpan. NIK yang sudah ada diperbarui; sel kosong tidak mengubah data lama; peran, sandi, nomor KTA, dan korlap tidak berubah. Templat bisa diunduh dari halaman Data Anggota.
- **Iuran potong gaji:** impor rekap HR (.xlsx atau .csv), pencocokan otomatis (tidak terpotong, nominal nol atau berubah lebih dari 50%, bukan anggota, anggota tidak aktif), catatan per baris, lalu kunci periode. Total iuran otomatis masuk kas. Data gaji tidak pernah disimpan.
- **Kas:** pengeluaran mulai Rp 500.000 menunggu validasi Ketua sebelum mengurangi saldo.
- **Advokasi:** anggota mengadu, Bidang Hukum memverifikasi dan menulis strategi, surat tugas bernomor otomatis dibuat, Ketua menyetujui atau meminta revisi.
- **Surat keluar dan surat masuk** dengan nomor otomatis dan disposisi.
- **Korlap** (struktur, basis, instruksi, aspirasi) dan **Garda Metal** (penugasan dan kesiapan personel).
- **Bidang:** pelatihan, usulan PKB, santunan (otomatis menjadi pengeluaran kas), dan donasi (masuk kas setelah diverifikasi bendahara).
- **Pengumuman** dan **log aktivitas**.
- **Bisa dipasang seperti aplikasi (PWA)** di Android, iPhone, dan laptop, dengan ikon di layar utama. Tampilan tersimpan di perangkat sehingga cepat terbuka dan tetap muncul saat sinyal hilang; data anggota tidak disimpan di perangkat.

## Deploy

Urutannya Neon, lalu Render, lalu Vercel, karena masing-masing butuh alamat dari langkah sebelumnya.

### 1. Neon (database)

1. Buat project baru di [neon.tech](https://neon.tech), pilih region **Asia Pacific (Singapore)**.
2. Buka **Connect**, salin connection string (diawali `postgresql://` dan diakhiri `?sslmode=require`).

Tabel tidak perlu dibuat manual. Server menjalankan `server/db/schema.sql` sendiri setiap kali mulai.

### 2. Render (backend)

1. Di [render.com](https://render.com), pilih **New > Blueprint**, hubungkan GitHub, lalu pilih repo ini. Render membaca `render.yaml`.
2. Isi variabel yang diminta:

   | Variabel | Isi |
   |---|---|
   | `DATABASE_URL` | connection string dari Neon |
   | `FRONTEND_URL` | alamat Vercel yang akan dipakai, misalnya `https://simpuk-sanly.vercel.app` (diperbaiki di langkah 3 bila ternyata berbeda) |
   | `SANDI_AWAL` | sandi awal untuk akun baru, minimal 8 karakter |
   | `ADMIN_NIK` | NIK Sekretaris yang akan jadi admin pertama |
   | `ADMIN_NAMA` | nama Sekretaris |

   `JWT_SECRET` dibuat acak otomatis oleh Render.
3. Tunggu sampai status **Live**, lalu buka `https://<nama-service>.onrender.com/api/health`. Hasilnya harus `{"ok":true}`.

### 3. Vercel (frontend)

1. Di [vercel.com](https://vercel.com), pilih **Add New > Project**, lalu impor repo ini.
2. Ubah **Root Directory** menjadi `client`. Framework terdeteksi sebagai Vite.
3. Di **Environment Variables**, tambahkan `VITE_API_URL` berisi alamat Render dari langkah 2 (tanpa garis miring di akhir).
4. Deploy. Setelah selesai, salin alamat Vercel-nya, kembali ke Render, perbaiki `FRONTEND_URL` dengan alamat itu, lalu simpan (Render akan deploy ulang).

### 4. Masuk pertama kali

1. Buka alamat Vercel, masuk dengan `ADMIN_NIK` dan `SANDI_AWAL`.
2. Ganti sandi awal.
3. Tambahkan anggota di **Data Anggota**, satu per satu atau sekaligus lewat **Impor dari Excel**, lalu atur peran pengurus di **Pengguna**. Semua anggota baru masuk dengan `SANDI_AWAL` dan wajib menggantinya.

### 5. Memasang di HP (PWA)

Fitur ini hanya aktif di alamat HTTPS, jadi berlaku setelah di-deploy ke Vercel.

- **Android (Chrome):** buka alamat SIMPUK, lalu tekan **Pasang aplikasi** di halaman login atau menu Akun. Bisa juga lewat menu titik tiga, lalu **Instal aplikasi**.
- **iPhone/iPad:** buka di **Safari**, tekan tombol Bagikan, lalu **Tambahkan ke Layar Utama**.
- **Laptop (Chrome/Edge):** tekan ikon pasang di ujung kanan kolom alamat.

Pembaruan aplikasi terpasang otomatis: setiap kali dibuka saat ada sinyal, versi terbaru yang dimuat.

## Menjalankan di komputer sendiri

Butuh Node.js 20 atau lebih baru dan PostgreSQL (atau langsung pakai database Neon).

```bash
# Backend
cd server
cp .env.example .env        # lalu isi
npm install
npm run dev                 # http://localhost:3000

# Data contoh untuk mencoba (HANYA untuk database kosong)
npm run seed:demo

# Frontend, di terminal lain
cd client
cp .env.example .env.local  # isi VITE_API_URL=http://localhost:3000
npm install
npm run dev                 # http://localhost:5173
```

`seed:demo` mengisi 18 anggota fiktif dengan berbagai peran. Semua akunnya memakai `SANDI_AWAL`. Skrip ini menolak berjalan bila tabel anggota sudah berisi data.

## Catatan

- **Render gratis tidur** setelah 15 menit tanpa akses. Akses pertama sesudahnya bisa butuh sekitar satu menit; halaman login menampilkan pesan selama menunggu.
- **Format data anggota:** judul kolom yang dikenali antara lain NIK, Nama, Departemen/Dept/Bagian, Plant, Status karyawan (PKWT, PKWTT, Kontrak, Tetap), Kontrak ke, Akhir kontrak, Mulai bekerja/Tgl masuk, Tanggal gabung, No HP, Garda Metal (Ya/Tidak), dan Keanggotaan (Aktif/Nonaktif/Keluar). Tanggal boleh berupa sel tanggal Excel atau teks seperti 31/12/2026 dan 30 Juni 2027. Bila Tanggal gabung kosong, dipakai tanggal mulai bekerja. Format kolom NIK sebagai teks di Excel bila ada NIK yang diawali angka 0.
- **Format rekap HR:** kolom dikenali dari judulnya, yaitu `NIK`, `Nama`, dan `Nominal`/`Potongan`/`Iuran`/`Jumlah`. Baris judul boleh di bawah baris lain, dan baris tanpa NIK valid (misalnya baris total) dilewati.
- **Batas validasi kas** bisa diubah lewat variabel `BATAS_VALIDASI` di Render (bawaan 500000).
- **Cadangan data:** Neon gratis menyimpan riwayat 24 jam. Untuk data organisasi, sebaiknya ekspor rutin dengan `pg_dump`.
