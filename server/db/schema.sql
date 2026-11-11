-- SIMPUK: skema PostgreSQL. Aman dijalankan berulang (dipanggil otomatis saat server mulai).

-- Tanggal hari ini menurut WIB, tidak bergantung pada zona waktu server database.
CREATE OR REPLACE FUNCTION hari_ini() RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date $$;

CREATE SEQUENCE IF NOT EXISTS kta_seq;

-- Anggota sekaligus akun login (satu anggota = satu akun, login dengan NIK).
CREATE TABLE IF NOT EXISTS anggota (
  nik              TEXT PRIMARY KEY CHECK (nik ~ '^[0-9]{6,20}$'),
  nama             TEXT NOT NULL,
  departemen       TEXT NOT NULL DEFAULT '',
  plant            TEXT NOT NULL DEFAULT '',
  korlap_nik       TEXT REFERENCES anggota(nik) ON DELETE SET NULL,
  is_korlap        BOOLEAN NOT NULL DEFAULT FALSE,
  garda            BOOLEAN NOT NULL DEFAULT FALSE,
  no_hp            TEXT NOT NULL DEFAULT '',
  status_karyawan  TEXT NOT NULL CHECK (status_karyawan IN ('pkwt', 'pkwtt')),
  kontrak_ke       SMALLINT,
  akhir_kontrak    DATE,
  mulai_kerja      DATE NOT NULL,
  tanggal_gabung   DATE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif', 'nonaktif', 'keluar')),
  no_kta           TEXT NOT NULL UNIQUE,
  peran            TEXT NOT NULL DEFAULT 'anggota',
  sandi_hash       TEXT NOT NULL,
  wajib_ganti      BOOLEAN NOT NULL DEFAULT TRUE,
  dibuat_pada      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cek_kontrak CHECK (
    (status_karyawan = 'pkwt' AND kontrak_ke >= 1) OR
    (status_karyawan = 'pkwtt' AND kontrak_ke IS NULL AND akhir_kontrak IS NULL)
  ),
  CONSTRAINT cek_akhir_kontrak CHECK (akhir_kontrak IS NULL OR akhir_kontrak >= mulai_kerja),
  CONSTRAINT cek_korlap_bukan_diri CHECK (korlap_nik IS NULL OR korlap_nik <> nik)
);
CREATE INDEX IF NOT EXISTS idx_anggota_korlap ON anggota(korlap_nik);

-- Iuran: satu periode per bulan, isinya baris dari rekap HR plus baris "tidak terpotong" buatan sistem.
CREATE TABLE IF NOT EXISTS periode_iuran (
  id            SERIAL PRIMARY KEY,
  tahun         SMALLINT NOT NULL,
  bulan         SMALLINT NOT NULL CHECK (bulan BETWEEN 1 AND 12),
  status        TEXT NOT NULL DEFAULT 'draf' CHECK (status IN ('draf', 'terkunci')),
  nama_file     TEXT NOT NULL DEFAULT '',
  diimpor_pada  TIMESTAMPTZ NOT NULL DEFAULT now(),
  dikunci_pada  TIMESTAMPTZ,
  UNIQUE (tahun, bulan)
);
CREATE TABLE IF NOT EXISTS iuran (
  id          SERIAL PRIMARY KEY,
  periode_id  INT NOT NULL REFERENCES periode_iuran(id) ON DELETE CASCADE,
  nik_hr      TEXT NOT NULL,
  nama_hr     TEXT NOT NULL DEFAULT '',
  nominal     NUMERIC(12,2) CHECK (nominal >= 0),     -- NULL untuk baris "tidak terpotong". Gaji tidak pernah disimpan.
  dari_hr     BOOLEAN NOT NULL DEFAULT TRUE,
  ket_impor   TEXT NOT NULL DEFAULT '',               -- catatan dari proses impor, mis. NIK ganda
  status      TEXT NOT NULL DEFAULT 'cocok' CHECK (status IN ('cocok', 'tidak_terpotong', 'anomali', 'bukan_anggota', 'anggota_tidak_aktif')),
  ket         TEXT NOT NULL DEFAULT '',
  catatan     TEXT NOT NULL DEFAULT '',
  UNIQUE (periode_id, nik_hr)
);

CREATE TABLE IF NOT EXISTS kas (
  id          SERIAL PRIMARY KEY,
  tanggal     DATE NOT NULL,
  jenis       TEXT NOT NULL CHECK (jenis IN ('masuk', 'keluar')),
  kategori    TEXT NOT NULL,
  keterangan  TEXT NOT NULL,
  nominal     NUMERIC(14,2) NOT NULL CHECK (nominal > 0),
  status      TEXT NOT NULL DEFAULT 'sah' CHECK (status IN ('sah', 'menunggu', 'ditolak')),
  oleh        TEXT NOT NULL,
  dibuat_pada TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS surat_keluar (
  id        SERIAL PRIMARY KEY,
  tahun     SMALLINT NOT NULL,
  urut      INT NOT NULL,
  nomor     TEXT NOT NULL UNIQUE,
  kode      TEXT NOT NULL CHECK (kode IN ('SK', 'UND', 'MDT', 'ST')),
  perihal   TEXT NOT NULL,
  tujuan    TEXT NOT NULL,
  tanggal   DATE NOT NULL DEFAULT hari_ini(),
  status    TEXT NOT NULL DEFAULT 'menunggu' CHECK (status IN ('menunggu', 'ttd', 'dikembalikan')),
  kasus_id  INT,
  oleh      TEXT NOT NULL,
  ttd_oleh  TEXT NOT NULL DEFAULT '',
  UNIQUE (tahun, urut)
);

CREATE TABLE IF NOT EXISTS aduan (
  id             SERIAL PRIMARY KEY,
  nik            TEXT NOT NULL REFERENCES anggota(nik) ON DELETE CASCADE,
  kategori       TEXT NOT NULL,
  judul          TEXT NOT NULL,
  isi            TEXT NOT NULL,
  tanggal        DATE NOT NULL DEFAULT hari_ini(),
  status         TEXT NOT NULL DEFAULT 'baru' CHECK (status IN ('baru', 'ditolak', 'menunggu_ketua', 'revisi', 'ditangani', 'selesai')),
  tanggapan      TEXT NOT NULL DEFAULT '',
  strategi       TEXT NOT NULL DEFAULT '',
  surat_id       INT REFERENCES surat_keluar(id) ON DELETE SET NULL,
  catatan_ketua  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS surat_masuk (
  id         SERIAL PRIMARY KEY,
  nomor      TEXT NOT NULL,
  pengirim   TEXT NOT NULL,
  perihal    TEXT NOT NULL,
  tanggal    DATE NOT NULL,
  disposisi  TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'baru' CHECK (status IN ('baru', 'didisposisi', 'selesai'))
);

CREATE TABLE IF NOT EXISTS pengumuman (
  id       SERIAL PRIMARY KEY,
  judul    TEXT NOT NULL,
  isi      TEXT NOT NULL,
  tanggal  DATE NOT NULL DEFAULT hari_ini(),
  oleh     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS diklat (
  id       SERIAL PRIMARY KEY,
  judul    TEXT NOT NULL,
  tanggal  DATE NOT NULL,
  tempat   TEXT NOT NULL,
  kuota    INT NOT NULL CHECK (kuota > 0)
);
CREATE TABLE IF NOT EXISTS diklat_peserta (
  diklat_id  INT NOT NULL REFERENCES diklat(id) ON DELETE CASCADE,
  nik        TEXT NOT NULL REFERENCES anggota(nik) ON DELETE CASCADE,
  PRIMARY KEY (diklat_id, nik)
);

CREATE TABLE IF NOT EXISTS pkb (
  id      SERIAL PRIMARY KEY,
  pasal   TEXT NOT NULL,
  usulan  TEXT NOT NULL,
  status  TEXT NOT NULL DEFAULT 'draf' CHECK (status IN ('draf', 'diusulkan', 'dirundingkan', 'disepakati'))
);

CREATE TABLE IF NOT EXISTS santunan (
  id       SERIAL PRIMARY KEY,
  nik      TEXT NOT NULL REFERENCES anggota(nik) ON DELETE CASCADE,
  jenis    TEXT NOT NULL,
  ket      TEXT NOT NULL,
  tanggal  DATE NOT NULL DEFAULT hari_ini(),
  status   TEXT NOT NULL DEFAULT 'baru' CHECK (status IN ('baru', 'disetujui', 'ditolak')),
  nominal  NUMERIC(14,2) NOT NULL DEFAULT 0,
  catatan  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS kampanye (
  id      SERIAL PRIMARY KEY,
  judul   TEXT NOT NULL,
  target  NUMERIC(14,2) NOT NULL CHECK (target > 0)
);
CREATE TABLE IF NOT EXISTS donasi (
  id           SERIAL PRIMARY KEY,
  kampanye_id  INT NOT NULL REFERENCES kampanye(id) ON DELETE CASCADE,
  nik          TEXT NOT NULL REFERENCES anggota(nik) ON DELETE CASCADE,
  nominal      NUMERIC(14,2) NOT NULL CHECK (nominal > 0),
  tanggal      DATE NOT NULL DEFAULT hari_ini(),
  status       TEXT NOT NULL DEFAULT 'menunggu' CHECK (status IN ('menunggu', 'sah'))
);

CREATE TABLE IF NOT EXISTS instruksi (
  id       SERIAL PRIMARY KEY,
  judul    TEXT NOT NULL,
  isi      TEXT NOT NULL,
  tanggal  DATE NOT NULL DEFAULT hari_ini(),
  oleh     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS instruksi_sampai (
  instruksi_id  INT NOT NULL REFERENCES instruksi(id) ON DELETE CASCADE,
  nik           TEXT NOT NULL REFERENCES anggota(nik) ON DELETE CASCADE,
  PRIMARY KEY (instruksi_id, nik)
);
CREATE TABLE IF NOT EXISTS aspirasi (
  id         SERIAL PRIMARY KEY,
  nik        TEXT NOT NULL REFERENCES anggota(nik) ON DELETE CASCADE,
  isi        TEXT NOT NULL,
  tanggal    DATE NOT NULL DEFAULT hari_ini(),
  status     TEXT NOT NULL DEFAULT 'baru' CHECK (status IN ('baru', 'ditindaklanjuti')),
  tanggapan  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS tugas_garda (
  id       SERIAL PRIMARY KEY,
  judul    TEXT NOT NULL,
  jenis    TEXT NOT NULL,
  tanggal  DATE NOT NULL,
  lokasi   TEXT NOT NULL,
  butuh    INT NOT NULL CHECK (butuh > 0)
);
CREATE TABLE IF NOT EXISTS tugas_personel (
  tugas_id  INT NOT NULL REFERENCES tugas_garda(id) ON DELETE CASCADE,
  nik       TEXT NOT NULL REFERENCES anggota(nik) ON DELETE CASCADE,
  PRIMARY KEY (tugas_id, nik)
);

CREATE TABLE IF NOT EXISTS log_aktivitas (
  id     BIGSERIAL PRIMARY KEY,
  nik    TEXT,
  oleh   TEXT NOT NULL,
  teks   TEXT NOT NULL,
  waktu  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_log_waktu ON log_aktivitas(waktu DESC);
