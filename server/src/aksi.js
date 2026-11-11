import bcrypt from 'bcryptjs';
import { LABEL, BATAS, ROMAWI, Galat, namaPeriode, rp } from './config.js';
import { cocokkan } from './iuran.js';

// ---- Pemeriksa masukan ----
const wajib = (v, nama, maks = 4000) => {
  const s = String(v ?? '').trim();
  if (!s) throw new Galat(`${nama} wajib diisi.`);
  if (s.length > maks) throw new Galat(`${nama} terlalu panjang.`);
  return s;
};
const opsional = (v, maks = 4000) => String(v ?? '').trim().slice(0, maks);
const tanggal = (v, nama) => {
  const s = String(v ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new Galat(`${nama} tidak valid.`);
  return s;
};
const bulat = (v, nama) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Galat(`${nama} harus berupa angka lebih dari nol.`);
  return n;
};
const pilihan = (v, daftar, nama) => { if (!daftar.includes(v)) throw new Galat(`${nama} tidak dikenal.`); return v; };
const satu = async (db, sql, p, pesan = 'Data tidak ditemukan.') => {
  const r = (await db.query(sql, p)).rows[0];
  if (!r) throw new Galat(pesan, 404);
  return r;
};

// Surat keluar: nomor urut per tahun, format 001/ST/PUK-FSPMI/XI/2026.
async function buatSurat(c, kode, perihal, tujuan, kasusId = null) {
  await c.db.query('SELECT pg_advisory_xact_lock(7301)');
  const t = (await c.db.query("SELECT EXTRACT(YEAR FROM hari_ini())::int AS tahun, EXTRACT(MONTH FROM hari_ini())::int AS bulan")).rows[0];
  const urut = (await c.db.query('SELECT COALESCE(MAX(urut), 0) + 1 AS n FROM surat_keluar WHERE tahun = $1', [t.tahun])).rows[0].n;
  const nomor = `${String(urut).padStart(3, '0')}/${kode}/PUK-FSPMI/${ROMAWI[t.bulan - 1]}/${t.tahun}`;
  return (await c.db.query(
    'INSERT INTO surat_keluar (tahun, urut, nomor, kode, perihal, tujuan, kasus_id, oleh) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, nomor',
    [t.tahun, urut, nomor, kode, perihal, tujuan, kasusId, c.u.nama]
  )).rows[0];
}

const kasKeluar = (c, kat, ket, nominal) => c.db.query(
  "INSERT INTO kas (tanggal, jenis, kategori, keterangan, nominal, status, oleh) VALUES (hari_ini(), 'keluar', $1, $2, $3, $4, $5)",
  [kat, ket, nominal, nominal >= BATAS ? 'menunggu' : 'sah', c.u.nama]
);

// Setiap aksi menerima c = { db, u, izin(kunci), log(teks) } dan b = isi permintaan. Semua berjalan dalam satu transaksi.
export const AKSI = {
  // ---------- Akun ----------
  async 'sandi-ganti'(c, b) {
    const baru = String(b.baru ?? '');
    const row = await satu(c.db, 'SELECT sandi_hash FROM anggota WHERE nik = $1', [c.u.nik]);
    if (!(await bcrypt.compare(String(b.lama ?? ''), row.sandi_hash))) throw new Galat('Sandi sekarang tidak cocok.');
    if (baru.length < 8) throw new Galat('Sandi baru minimal 8 karakter.');
    if (baru === b.lama) throw new Galat('Sandi baru harus berbeda dari sandi sekarang.');
    await c.db.query('UPDATE anggota SET sandi_hash = $1, wajib_ganti = FALSE WHERE nik = $2', [await bcrypt.hash(baru, 10), c.u.nik]);
    await c.log('Mengganti sandi');
  },
  async 'sandi-reset'(c, b) {
    c.izin('pengguna');
    const a = await satu(c.db, 'SELECT nama FROM anggota WHERE nik = $1', [b.nik]);
    await c.db.query('UPDATE anggota SET sandi_hash = $1, wajib_ganti = TRUE WHERE nik = $2', [await bcrypt.hash(process.env.SANDI_AWAL, 10), b.nik]);
    await c.log(`Mereset sandi ${a.nama}`);
  },
  async 'peran-ubah'(c, b) {
    c.izin('pengguna');
    if (b.nik === c.u.nik) throw new Galat('Peran Anda sendiri tidak bisa diubah dari sini.');
    pilihan(b.peran, Object.keys(LABEL), 'Peran');
    const a = await satu(c.db, 'UPDATE anggota SET peran = $1 WHERE nik = $2 RETURNING nama', [b.peran, b.nik]);
    await c.log(`Mengubah peran ${a.nama} menjadi ${LABEL[b.peran]}`);
  },

  // ---------- Anggota ----------
  async 'anggota-simpan'(c, b) {
    c.izin('anggotaUbah');
    const nik = String(b.nik ?? '').trim();
    if (!/^\d{6,20}$/.test(nik)) throw new Galat('NIK harus berupa 6 sampai 20 angka.');
    const nama = wajib(b.nama, 'Nama', 150), dept = wajib(b.dept, 'Departemen', 100), plant = wajib(b.plant, 'Plant', 50);
    const kar = pilihan(b.kar, ['pkwt', 'pkwtt'], 'Status karyawan'), status = pilihan(b.status, ['aktif', 'nonaktif', 'keluar'], 'Keanggotaan');
    const mulai = tanggal(b.mulai, 'Tanggal mulai bekerja'), gabung = tanggal(b.gabung, 'Tanggal gabung PUK');
    let kontrakKe = null, akhir = null;
    if (kar === 'pkwt') {
      kontrakKe = bulat(b.kontrakKe, 'Kontrak ke');
      if (b.akhir) { akhir = tanggal(b.akhir, 'Akhir kontrak'); if (akhir < mulai) throw new Galat('Akhir kontrak tidak boleh lebih awal dari tanggal mulai bekerja.'); }
    }
    const isi = [nama, dept, plant, opsional(b.hp, 30), kar, kontrakKe, akhir, mulai, gabung, status, !!b.garda];
    if (b.baru) {
      if ((await c.db.query('SELECT 1 FROM anggota WHERE nik = $1', [nik])).rowCount) throw new Galat(`NIK ${nik} sudah terdaftar.`);
      await c.db.query(
        `INSERT INTO anggota (nik, nama, departemen, plant, no_hp, status_karyawan, kontrak_ke, akhir_kontrak, mulai_kerja, tanggal_gabung, status, garda, no_kta, sandi_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'KTA-' || lpad(nextval('kta_seq')::text, 4, '0'), $13)`,
        [nik, ...isi, await bcrypt.hash(process.env.SANDI_AWAL, 10)]
      );
      await c.log(`Menambah anggota ${nama} (${nik})`);
    } else {
      await satu(c.db,
        `UPDATE anggota SET nama = $2, departemen = $3, plant = $4, no_hp = $5, status_karyawan = $6, kontrak_ke = $7, akhir_kontrak = $8,
         mulai_kerja = $9, tanggal_gabung = $10, status = $11, garda = $12 WHERE nik = $1 RETURNING nik`, [nik, ...isi]);
      if (status !== 'aktif') {   // anggota yang tidak aktif lagi dilepas dari struktur korlap
        await c.db.query('UPDATE anggota SET korlap_nik = NULL WHERE korlap_nik = $1', [nik]);
        await c.db.query('UPDATE anggota SET is_korlap = FALSE, korlap_nik = NULL WHERE nik = $1', [nik]);
      }
      await c.log(`Mengubah data ${nama} (${nik})`);
    }
  },

  // ---------- Korlap ----------
  async 'korlap-tetap'(c, b) {
    c.izin('korlapKelola');
    const a = await satu(c.db, "UPDATE anggota SET is_korlap = TRUE WHERE nik = $1 AND status = 'aktif' RETURNING nama", [b.nik], 'Anggota aktif tidak ditemukan.');
    await c.log(`Menetapkan ${a.nama} sebagai korlap`);
  },
  async 'korlap-cabut'(c, b) {
    c.izin('korlapKelola');
    const a = await satu(c.db, 'UPDATE anggota SET is_korlap = FALSE WHERE nik = $1 RETURNING nama', [b.nik]);
    await c.db.query('UPDATE anggota SET korlap_nik = NULL WHERE korlap_nik = $1', [b.nik]);
    await c.log(`Mencabut penetapan korlap ${a.nama}`);
  },
  async 'korlap-tambah'(c, b) {
    c.izin('korlapKelola');
    if (b.nik === b.korlap) throw new Galat('Korlap tidak bisa menjadi anggota basisnya sendiri.');
    const k = await satu(c.db, "SELECT nama FROM anggota WHERE nik = $1 AND is_korlap AND status = 'aktif'", [b.korlap], 'Korlap tidak ditemukan.');
    const a = await satu(c.db, "UPDATE anggota SET korlap_nik = $1 WHERE nik = $2 AND status = 'aktif' RETURNING nama", [b.korlap, b.nik], 'Anggota aktif tidak ditemukan.');
    await c.log(`Memasukkan ${a.nama} ke basis ${k.nama}`);
  },
  async 'korlap-lepas'(c, b) {
    c.izin('korlapKelola');
    const a = await satu(c.db, 'UPDATE anggota SET korlap_nik = NULL WHERE nik = $1 RETURNING nama', [b.nik]);
    await c.log(`Melepas ${a.nama} dari basis korlap`);
  },
  async 'instruksi-kirim'(c, b) {
    c.izin('korlapKelola');
    const judul = wajib(b.judul, 'Judul', 200);
    await c.db.query('INSERT INTO instruksi (judul, isi, oleh) VALUES ($1, $2, $3)', [judul, wajib(b.isi, 'Isi instruksi'), c.u.nama]);
    await c.log(`Mengirim instruksi ke korlap: ${judul}`);
  },
  async 'instruksi-sampai'(c, b) {
    if (!c.u.is_korlap) throw new Galat('Hanya korlap yang bisa menandai instruksi.', 403);
    const i = await satu(c.db, 'SELECT judul FROM instruksi WHERE id = $1', [b.id]);
    await c.db.query('INSERT INTO instruksi_sampai (instruksi_id, nik) VALUES ($1, $2) ON CONFLICT DO NOTHING', [b.id, c.u.nik]);
    await c.log(`Menyampaikan instruksi "${i.judul}" ke basis`);
  },
  async 'aspirasi-kirim'(c, b) {
    if (!c.u.is_korlap) throw new Galat('Hanya korlap yang bisa menyampaikan aspirasi basis.', 403);
    await c.db.query('INSERT INTO aspirasi (nik, isi) VALUES ($1, $2)', [c.u.nik, wajib(b.isi, 'Aspirasi')]);
    await c.log('Menyampaikan aspirasi basis');
  },
  async 'aspirasi-tindak'(c, b) {
    c.izin('korlapKelola');
    await satu(c.db, "UPDATE aspirasi SET status = 'ditindaklanjuti', tanggapan = $1 WHERE id = $2 AND status = 'baru' RETURNING id", [wajib(b.tanggapan, 'Tanggapan'), b.id]);
    await c.log('Menindaklanjuti aspirasi basis');
  },

  // ---------- Garda Metal ----------
  async 'tugas-buat'(c, b) {
    c.izin('gardaKelola');
    const judul = wajib(b.judul, 'Nama kegiatan', 200);
    await c.db.query('INSERT INTO tugas_garda (judul, jenis, tanggal, lokasi, butuh) VALUES ($1, $2, $3, $4, $5)',
      [judul, wajib(b.jenis, 'Jenis', 60), tanggal(b.tgl, 'Tanggal'), wajib(b.lokasi, 'Lokasi', 200), bulat(b.butuh, 'Jumlah personel')]);
    await c.log(`Membuat penugasan Garda Metal: ${judul}`);
  },
  async 'tugas-siap'(c, b) {
    if (!c.u.garda) throw new Galat('Hanya anggota Garda Metal yang bisa menyatakan siap.', 403);
    const t = await satu(c.db, 'SELECT judul, butuh FROM tugas_garda WHERE id = $1 FOR UPDATE', [b.id]);
    const hapus = await c.db.query('DELETE FROM tugas_personel WHERE tugas_id = $1 AND nik = $2', [b.id, c.u.nik]);
    if (hapus.rowCount) return;
    const n = (await c.db.query('SELECT COUNT(*) AS n FROM tugas_personel WHERE tugas_id = $1', [b.id])).rows[0].n;
    if (n >= t.butuh) throw new Galat('Personel untuk penugasan ini sudah cukup.');
    await c.db.query('INSERT INTO tugas_personel (tugas_id, nik) VALUES ($1, $2)', [b.id, c.u.nik]);
    await c.log(`Siap bertugas: ${t.judul}`);
  },

  // ---------- Iuran ----------
  async 'iuran-cocokkan'(c, b) {
    c.izin('iuranKelola');
    const p = await satu(c.db, "SELECT id, tahun, bulan FROM periode_iuran WHERE id = $1 AND status = 'draf' FOR UPDATE", [b.periode], 'Periode draf tidak ditemukan.');
    await cocokkan(c.db, p.id);
    await c.log(`Mencocokkan ulang rekap iuran ${namaPeriode(p.tahun, p.bulan)}`);
  },
  async 'iuran-catatan'(c, b) {
    c.izin('iuranKelola');
    await satu(c.db,
      "UPDATE iuran i SET catatan = $1 FROM periode_iuran p WHERE i.id = $2 AND p.id = i.periode_id AND p.status = 'draf' RETURNING i.id",
      [opsional(b.catatan, 500), b.id], 'Baris tidak ditemukan atau periodenya sudah dikunci.');
  },
  async 'iuran-kunci'(c, b) {
    c.izin('iuranKelola');
    const p = await satu(c.db, "UPDATE periode_iuran SET status = 'terkunci', dikunci_pada = now() WHERE id = $1 AND status = 'draf' RETURNING tahun, bulan", [b.periode], 'Periode draf tidak ditemukan.');
    const total = (await c.db.query('SELECT COALESCE(SUM(nominal), 0) AS t FROM iuran WHERE periode_id = $1', [b.periode])).rows[0].t;
    const nama = namaPeriode(p.tahun, p.bulan);
    if (total > 0) await c.db.query("INSERT INTO kas (tanggal, jenis, kategori, keterangan, nominal, oleh) VALUES (hari_ini(), 'masuk', 'Iuran', $1, $2, $3)", [`Iuran ${nama}`, total, c.u.nama]);
    await c.log(`Mengunci periode iuran ${nama} (${rp(total)})`);
  },

  // ---------- Kas ----------
  async 'kas-catat'(c, b) {
    c.izin('kasCatat');
    const jenis = pilihan(b.jenis, ['masuk', 'keluar'], 'Jenis'), nominal = bulat(b.nominal, 'Nominal'), ket = wajib(b.ket, 'Keterangan', 300);
    const tunggu = jenis === 'keluar' && nominal >= BATAS;
    await c.db.query('INSERT INTO kas (tanggal, jenis, kategori, keterangan, nominal, status, oleh) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [tanggal(b.tgl, 'Tanggal'), jenis, wajib(b.kat, 'Kategori', 60), ket, nominal, tunggu ? 'menunggu' : 'sah', c.u.nama]);
    await c.log(`Mencatat kas ${jenis}: ${ket} (${rp(nominal)})${tunggu ? ', menunggu validasi Ketua' : ''}`);
  },
  async 'kas-validasi'(c, b) {
    c.izin('kasValidasi');
    const t = await satu(c.db, "UPDATE kas SET status = $1 WHERE id = $2 AND status = 'menunggu' RETURNING keterangan, nominal", [b.setuju ? 'sah' : 'ditolak', b.id], 'Transaksi yang menunggu validasi tidak ditemukan.');
    await c.log(`${b.setuju ? 'Menyetujui' : 'Menolak'} pengeluaran: ${t.keterangan} (${rp(t.nominal)})`);
  },

  // ---------- Advokasi ----------
  async 'aduan-kirim'(c, b) {
    await c.db.query('INSERT INTO aduan (nik, kategori, judul, isi) VALUES ($1, $2, $3, $4)', [c.u.nik, wajib(b.kat, 'Kategori', 60), wajib(b.judul, 'Judul', 200), wajib(b.isi, 'Isi pengaduan')]);
    await c.log('Mengirim pengaduan');
  },
  async 'aduan-valid'(c, b) {
    c.izin('kasusProses');
    const d = await satu(c.db, "SELECT id, judul, surat_id FROM aduan WHERE id = $1 AND status IN ('baru', 'revisi') FOR UPDATE", [b.id], 'Pengaduan tidak ditemukan atau sudah diproses.');
    const strategi = wajib(b.strategi, 'Analisis dan strategi');
    let suratId = d.surat_id, nomor;
    if (suratId) nomor = (await c.db.query("UPDATE surat_keluar SET status = 'menunggu' WHERE id = $1 RETURNING nomor", [suratId])).rows[0].nomor;
    else { const s = await buatSurat(c, 'ST', `Surat tugas advokasi: ${d.judul}`, 'Tim advokasi PUK', d.id); suratId = s.id; nomor = s.nomor; }
    await c.db.query("UPDATE aduan SET status = 'menunggu_ketua', strategi = $1, tanggapan = $2, surat_id = $3, catatan_ketua = '' WHERE id = $4",
      [strategi, opsional(b.tanggapan) || 'Kasus Anda diterima dan sedang diproses.', suratId, d.id]);
    await c.log(`Memvalidasi kasus "${d.judul}" dan mengajukan surat tugas ${nomor}`);
  },
  async 'aduan-tolak'(c, b) {
    c.izin('kasusProses');
    const d = await satu(c.db, "UPDATE aduan SET status = 'ditolak', tanggapan = $1 WHERE id = $2 AND status IN ('baru', 'revisi') RETURNING judul", [wajib(b.tanggapan, 'Alasan penolakan'), b.id]);
    await c.log(`Menolak kasus "${d.judul}"`);
  },
  async 'aduan-acc'(c, b) {
    c.izin('kasusAcc');
    const d = await satu(c.db, "UPDATE aduan SET status = 'ditangani', catatan_ketua = $1 WHERE id = $2 AND status = 'menunggu_ketua' RETURNING judul, surat_id", [opsional(b.catatan), b.id]);
    if (d.surat_id) await c.db.query("UPDATE surat_keluar SET status = 'ttd', ttd_oleh = $1 WHERE id = $2", [c.u.nama, d.surat_id]);
    await c.log(`Menyetujui kasus "${d.judul}" dan menandatangani surat tugas`);
  },
  async 'aduan-revisi'(c, b) {
    c.izin('kasusAcc');
    const d = await satu(c.db, "UPDATE aduan SET status = 'revisi', catatan_ketua = $1 WHERE id = $2 AND status = 'menunggu_ketua' RETURNING judul, surat_id", [wajib(b.catatan, 'Catatan revisi'), b.id]);
    if (d.surat_id) await c.db.query("UPDATE surat_keluar SET status = 'dikembalikan' WHERE id = $1", [d.surat_id]);
    await c.log(`Meminta revisi berkas kasus "${d.judul}"`);
  },
  async 'aduan-selesai'(c, b) {
    c.izin('kasusProses');
    const t = opsional(b.tanggapan);
    const d = await satu(c.db, "UPDATE aduan SET status = 'selesai', tanggapan = CASE WHEN $1 <> '' THEN $1 ELSE tanggapan END WHERE id = $2 AND status = 'ditangani' RETURNING judul", [t, b.id]);
    await c.log(`Menutup kasus "${d.judul}"`);
  },

  // ---------- Surat ----------
  async 'surat-buat'(c, b) {
    c.izin('suratBuat');
    const perihal = wajib(b.perihal, 'Perihal', 300);
    const s = await buatSurat(c, pilihan(b.kode, ['SK', 'UND', 'MDT'], 'Jenis surat'), perihal, wajib(b.tujuan, 'Tujuan surat', 200));
    await c.log(`Membuat surat ${s.nomor}: ${perihal}`);
  },
  async 'surat-ttd'(c, b) {
    c.izin('suratTtd');
    const s = await satu(c.db, "UPDATE surat_keluar SET status = 'ttd', ttd_oleh = $1 WHERE id = $2 AND status = 'menunggu' RETURNING nomor, kasus_id", [c.u.nama, b.id]);
    if (s.kasus_id) await c.db.query("UPDATE aduan SET status = 'ditangani' WHERE id = $1 AND status = 'menunggu_ketua'", [s.kasus_id]);
    await c.log(`Menandatangani surat ${s.nomor}`);
  },
  async 'surat-kembali'(c, b) {
    c.izin('suratTtd');
    const s = await satu(c.db, "UPDATE surat_keluar SET status = 'dikembalikan' WHERE id = $1 AND status = 'menunggu' RETURNING nomor, kasus_id", [b.id]);
    if (s.kasus_id) await c.db.query("UPDATE aduan SET status = 'revisi' WHERE id = $1 AND status = 'menunggu_ketua'", [s.kasus_id]);
    await c.log(`Mengembalikan surat ${s.nomor}`);
  },
  async 'suratmasuk-catat'(c, b) {
    c.izin('suratMasukCatat');
    const no = wajib(b.no, 'Nomor surat', 100);
    await c.db.query('INSERT INTO surat_masuk (nomor, pengirim, perihal, tanggal) VALUES ($1, $2, $3, $4)', [no, wajib(b.pengirim, 'Pengirim', 200), wajib(b.perihal, 'Perihal', 300), tanggal(b.tgl, 'Tanggal diterima')]);
    await c.log(`Mencatat surat masuk ${no}`);
  },
  async 'suratmasuk-disposisi'(c, b) {
    c.izin('disposisi');
    pilihan(b.tujuan, Object.keys(LABEL).filter((k) => k !== 'anggota' && k !== 'ketua'), 'Tujuan disposisi');
    const s = await satu(c.db, "UPDATE surat_masuk SET disposisi = $1, status = 'didisposisi' WHERE id = $2 AND status <> 'selesai' RETURNING nomor", [b.tujuan, b.id]);
    await c.log(`Mendisposisi surat ${s.nomor} ke ${LABEL[b.tujuan]}`);
  },
  async 'suratmasuk-selesai'(c, b) {
    const s = await satu(c.db, "SELECT nomor, disposisi FROM surat_masuk WHERE id = $1 AND status = 'didisposisi'", [b.id]);
    if (s.disposisi !== c.u.peran && c.u.peran !== 'admin') throw new Galat('Surat ini tidak didisposisikan ke Anda.', 403);
    await c.db.query("UPDATE surat_masuk SET status = 'selesai' WHERE id = $1", [b.id]);
    await c.log(`Menyelesaikan surat masuk ${s.nomor}`);
  },

  // ---------- Pengumuman ----------
  async 'umum-buat'(c, b) {
    c.izin('umumBuat');
    const judul = wajib(b.judul, 'Judul', 200);
    await c.db.query('INSERT INTO pengumuman (judul, isi, oleh) VALUES ($1, $2, $3)', [judul, wajib(b.isi, 'Isi pengumuman'), c.u.nama]);
    await c.log(`Menerbitkan pengumuman: ${judul}`);
  },
  async 'umum-hapus'(c, b) {
    c.izin('umumBuat');
    const u = await satu(c.db, 'DELETE FROM pengumuman WHERE id = $1 RETURNING judul', [b.id]);
    await c.log(`Menghapus pengumuman: ${u.judul}`);
  },

  // ---------- Bidang ----------
  async 'diklat-buat'(c, b) {
    c.izin('diklatKelola');
    const judul = wajib(b.judul, 'Judul', 200);
    await c.db.query('INSERT INTO diklat (judul, tanggal, tempat, kuota) VALUES ($1, $2, $3, $4)', [judul, tanggal(b.tgl, 'Tanggal'), wajib(b.tempat, 'Tempat', 200), bulat(b.kuota, 'Kuota')]);
    await c.log(`Menjadwalkan pelatihan: ${judul}`);
  },
  async 'diklat-ikut'(c, b) {
    const d = await satu(c.db, 'SELECT judul, kuota FROM diklat WHERE id = $1 FOR UPDATE', [b.id]);
    const hapus = await c.db.query('DELETE FROM diklat_peserta WHERE diklat_id = $1 AND nik = $2', [b.id, c.u.nik]);
    if (hapus.rowCount) return;
    const n = (await c.db.query('SELECT COUNT(*) AS n FROM diklat_peserta WHERE diklat_id = $1', [b.id])).rows[0].n;
    if (n >= d.kuota) throw new Galat('Kuota pelatihan ini sudah penuh.');
    await c.db.query('INSERT INTO diklat_peserta (diklat_id, nik) VALUES ($1, $2)', [b.id, c.u.nik]);
    await c.log(`Mendaftar pelatihan: ${d.judul}`);
  },
  async 'pkb-tambah'(c, b) {
    c.izin('pkbKelola');
    const pasal = wajib(b.pasal, 'Pasal atau topik', 200);
    await c.db.query('INSERT INTO pkb (pasal, usulan) VALUES ($1, $2)', [pasal, wajib(b.usulan, 'Isi usulan')]);
    await c.log(`Menambah usulan PKB: ${pasal}`);
  },
  async 'pkb-status'(c, b) {
    c.izin('pkbKelola');
    pilihan(b.status, ['draf', 'diusulkan', 'dirundingkan', 'disepakati'], 'Status');
    const u = await satu(c.db, 'UPDATE pkb SET status = $1 WHERE id = $2 RETURNING pasal', [b.status, b.id]);
    await c.log(`Mengubah status usulan PKB "${u.pasal}" menjadi ${b.status}`);
  },
  async 'santunan-ajukan'(c, b) {
    await c.db.query('INSERT INTO santunan (nik, jenis, ket) VALUES ($1, $2, $3)', [c.u.nik, wajib(b.jenis, 'Jenis', 60), wajib(b.ket, 'Keterangan', 500)]);
    await c.log('Mengajukan santunan');
  },
  async 'santunan-setuju'(c, b) {
    c.izin('sosialKelola');
    const nominal = bulat(b.nominal, 'Nominal santunan');
    const s = await satu(c.db,
      "UPDATE santunan s SET status = 'disetujui', nominal = $1, catatan = $2 FROM anggota a WHERE s.id = $3 AND s.status = 'baru' AND a.nik = s.nik RETURNING s.jenis, a.nama",
      [nominal, opsional(b.catatan, 500), b.id], 'Pengajuan tidak ditemukan atau sudah diproses.');
    await kasKeluar(c, 'Santunan', `Santunan ${s.jenis.toLowerCase()}: ${s.nama}`, nominal);
    await c.log(`Menyetujui santunan ${s.nama} (${rp(nominal)})`);
  },
  async 'santunan-tolak'(c, b) {
    c.izin('sosialKelola');
    const s = await satu(c.db,
      "UPDATE santunan s SET status = 'ditolak', catatan = $1 FROM anggota a WHERE s.id = $2 AND s.status = 'baru' AND a.nik = s.nik RETURNING a.nama",
      [wajib(b.catatan, 'Alasan penolakan', 500), b.id], 'Pengajuan tidak ditemukan atau sudah diproses.');
    await c.log(`Menolak pengajuan santunan ${s.nama}`);
  },
  async 'kampanye-buat'(c, b) {
    c.izin('kampanye');
    const judul = wajib(b.judul, 'Judul', 200);
    await c.db.query('INSERT INTO kampanye (judul, target) VALUES ($1, $2)', [judul, bulat(b.target, 'Target')]);
    await c.log(`Membuka penggalangan donasi: ${judul}`);
  },
  async 'donasi-catat'(c, b) {
    const nominal = bulat(b.nominal, 'Nominal');
    await satu(c.db, 'SELECT id FROM kampanye WHERE id = $1', [b.kampanye], 'Penggalangan tidak ditemukan.');
    await c.db.query('INSERT INTO donasi (kampanye_id, nik, nominal) VALUES ($1, $2, $3)', [b.kampanye, c.u.nik, nominal]);
    await c.log(`Mencatat donasi ${rp(nominal)}`);
  },
  async 'donasi-verif'(c, b) {
    c.izin('donasiVerif');
    const d = await satu(c.db,
      "UPDATE donasi d SET status = 'sah' FROM kampanye k, anggota a WHERE d.id = $1 AND d.status = 'menunggu' AND k.id = d.kampanye_id AND a.nik = d.nik RETURNING d.nominal, k.judul, a.nama",
      [b.id], 'Donasi yang menunggu verifikasi tidak ditemukan.');
    await c.db.query("INSERT INTO kas (tanggal, jenis, kategori, keterangan, nominal, oleh) VALUES (hari_ini(), 'masuk', 'Donasi', $1, $2, $3)", [`Donasi: ${d.judul}`, d.nominal, c.u.nama]);
    await c.log(`Memverifikasi donasi ${rp(d.nominal)} dari ${d.nama}`);
  }
};
