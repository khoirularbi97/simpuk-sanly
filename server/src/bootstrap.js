import { BATAS, boleh } from './config.js';

const SEL_ANGGOTA = `SELECT nik, nama, departemen AS dept, plant, COALESCE(korlap_nik, '') AS korlap, is_korlap AS "isKorlap", garda, no_hp AS hp,
  status_karyawan AS kar, kontrak_ke AS "kontrakKe", COALESCE(akhir_kontrak::text, '') AS akhir, mulai_kerja AS mulai, tanggal_gabung AS gabung,
  status, no_kta AS kta, peran FROM anggota`;

// Mengembalikan semua data yang boleh dilihat pengguna ini, dalam bentuk yang dipakai tampilan.
export async function bootstrap(db, u, periodeKey) {
  const r = u.peran, pengurus = r !== 'anggota';
  const semua = async (sql, p) => (await db.query(sql, p)).rows;
  const out = { user: { nik: u.nik, nama: u.nama }, role: r, wajibGanti: u.wajib_ganti, batas: BATAS };
  if (u.wajib_ganti) return out;   // sebelum sandi awal diganti, tidak ada data yang dikirim

  // Anggota: pengurus melihat semua. Anggota biasa hanya dirinya, korlapnya, basisnya (bila korlap), dan rekan Garda Metal.
  if (pengurus) out.anggota = await semua(SEL_ANGGOTA + ' ORDER BY nama');
  else {
    const rows = await semua(SEL_ANGGOTA + ` WHERE nik = $1 OR nik = (SELECT korlap_nik FROM anggota WHERE nik = $1)
      OR ($2 AND korlap_nik = $1 AND status = 'aktif') OR ($3 AND garda AND status = 'aktif') ORDER BY nama`, [u.nik, u.is_korlap, u.garda]);
    out.anggota = rows.map((a) => (a.nik === u.nik || (u.is_korlap && a.korlap === u.nik)) ? a
      : { nik: a.nik, nama: a.nama, dept: a.dept, plant: a.plant, korlap: a.korlap, isKorlap: a.isKorlap, garda: a.garda, status: a.status });
  }
  if (r !== 'admin') out.anggota.forEach((a) => { delete a.peran; });

  // Iuran: nominal per orang hanya untuk bendahara dan pemilik potongan.
  if (pengurus) {
    out.periodeList = await semua('SELECT id, tahun, bulan, status FROM periode_iuran ORDER BY tahun DESC, bulan DESC');
    const kunci = (x) => `${x.tahun}-${String(x.bulan).padStart(2, '0')}`;
    const pilih = out.periodeList.find((x) => kunci(x) === periodeKey) || out.periodeList[0];
    out.periode = null;
    if (pilih) {
      const info = (await semua('SELECT id, tahun, bulan, status, nama_file AS "namaFile", diimpor_pada AS waktu FROM periode_iuran WHERE id = $1', [pilih.id]))[0];
      const rows = await semua('SELECT id, nik_hr AS nik, nama_hr AS nama, nominal, dari_hr, status, ket, catatan FROM iuran WHERE periode_id = $1 ORDER BY nama_hr, nik_hr', [pilih.id]);
      const lihat = boleh(r, 'iuranKelola');
      info.total = rows.reduce((t, x) => t + (x.nominal || 0), 0);
      info.jumlahHr = rows.filter((x) => x.dari_hr).length;
      info.rows = rows.map((x) => ({
        id: x.id, nik: x.nik, nama: x.nama, status: x.status, catatan: x.catatan,
        nominal: lihat ? x.nominal : null, sembunyi: !lihat && x.nominal != null,
        ket: lihat ? x.ket : x.ket.replace(/\s*\(Rp[^)]*\)/, '')
      }));
      out.periode = info;
    }
  }
  out.iuranSaya = await semua(`SELECT p.tahun, p.bulan, i.nominal FROM periode_iuran p
    LEFT JOIN iuran i ON i.periode_id = p.id AND i.nik_hr = $1 AND i.dari_hr
    WHERE p.status = 'terkunci' ORDER BY p.tahun DESC, p.bulan DESC LIMIT 12`, [u.nik]);

  // Kas: rincian untuk pengurus, ringkasan untuk semua.
  const ring = (await semua("SELECT COALESCE(SUM(nominal) FILTER (WHERE jenis = 'masuk'), 0) AS masuk, COALESCE(SUM(nominal) FILTER (WHERE jenis = 'keluar'), 0) AS keluar FROM kas WHERE status = 'sah'"))[0];
  out.kasRingkas = { masuk: ring.masuk, keluar: ring.keluar, saldo: ring.masuk - ring.keluar };
  if (pengurus) out.kas = await semua('SELECT id, tanggal AS tgl, jenis, kategori AS kat, keterangan AS ket, nominal, status, oleh FROM kas ORDER BY tanggal DESC, id DESC');

  // Advokasi dan surat.
  const SEL_ADUAN = 'SELECT id, nik, kategori AS kat, judul, isi, tanggal AS tgl, status, tanggapan, strategi, surat_id AS "suratId", catatan_ketua AS "catatanKetua" FROM aduan';
  const SEL_SURAT = 'SELECT id, nomor AS no, kode, perihal, tujuan, tanggal AS tgl, status, kasus_id AS "kasusId", oleh, ttd_oleh AS "ttdOleh" FROM surat_keluar';
  if (boleh(r, 'kasus')) out.aduan = await semua(SEL_ADUAN + ' ORDER BY id DESC');
  else {
    out.aduan = (await semua(SEL_ADUAN + ' WHERE nik = $1 ORDER BY id DESC', [u.nik]))
      .map((d) => ({ ...d, strategi: '', catatanKetua: '' }));   // analisis internal tidak dikirim ke pengadu
  }
  if (boleh(r, 'surat')) out.surat = await semua(SEL_SURAT + ' ORDER BY id DESC');
  else out.surat = await semua(SEL_SURAT + " WHERE status = 'ttd' AND kasus_id IN (SELECT id FROM aduan WHERE nik = $1)", [u.nik]);
  if (pengurus) out.suratMasuk = await semua('SELECT id, nomor AS no, pengirim, perihal, tanggal AS tgl, disposisi, status FROM surat_masuk ORDER BY id DESC');

  out.umum = await semua('SELECT id, judul, isi, tanggal AS tgl, oleh FROM pengumuman ORDER BY tanggal DESC, id DESC');

  // Bidang.
  const diklat = await semua('SELECT id, judul, tanggal AS tgl, tempat, kuota FROM diklat ORDER BY tanggal');
  const peserta = await semua('SELECT diklat_id, nik FROM diklat_peserta');
  out.diklat = diklat.map((d) => {
    const p = peserta.filter((x) => x.diklat_id === d.id).map((x) => x.nik);
    return { ...d, jumlah: p.length, peserta: boleh(r, 'diklatKelola') ? p : p.filter((n) => n === u.nik) };
  });
  out.pkb = await semua('SELECT id, pasal, usulan, status FROM pkb ORDER BY id');
  const SEL_SOS = 'SELECT id, nik, jenis, ket, tanggal AS tgl, status, nominal, catatan FROM santunan';
  out.sosial = pengurus ? await semua(SEL_SOS + ' ORDER BY id DESC') : await semua(SEL_SOS + ' WHERE nik = $1 ORDER BY id DESC', [u.nik]);
  out.kampanye = await semua("SELECT k.id, k.judul, k.target, COALESCE((SELECT SUM(nominal) FROM donasi d WHERE d.kampanye_id = k.id AND d.status = 'sah'), 0) AS terkumpul FROM kampanye k ORDER BY k.id");
  const SEL_DON = 'SELECT id, kampanye_id AS kampanye, nik, nominal, tanggal AS tgl, status FROM donasi';
  out.donasi = boleh(r, 'donasiVerif') ? await semua(SEL_DON + ' ORDER BY id DESC') : await semua(SEL_DON + ' WHERE nik = $1 ORDER BY id DESC', [u.nik]);

  // Perangkat: korlap dan Garda Metal.
  if (pengurus || u.is_korlap) {
    const ins = await semua('SELECT id, judul, isi, tanggal AS tgl, oleh FROM instruksi ORDER BY id DESC');
    const sampai = await semua('SELECT instruksi_id, nik FROM instruksi_sampai');
    out.instruksi = ins.map((i) => {
      const s = sampai.filter((x) => x.instruksi_id === i.id).map((x) => x.nik);
      return { ...i, sampai: pengurus ? s : s.filter((n) => n === u.nik) };
    });
    const SEL_ASP = 'SELECT id, nik, isi, tanggal AS tgl, status, tanggapan FROM aspirasi';
    out.aspirasi = pengurus ? await semua(SEL_ASP + ' ORDER BY id DESC') : await semua(SEL_ASP + ' WHERE nik = $1 ORDER BY id DESC', [u.nik]);
  }
  if (pengurus || u.garda) {
    const tugas = await semua('SELECT id, judul, jenis, tanggal AS tgl, lokasi, butuh FROM tugas_garda ORDER BY tanggal');
    const personel = await semua('SELECT tugas_id, nik FROM tugas_personel');
    out.tugasGarda = tugas.map((t) => ({ ...t, personel: personel.filter((x) => x.tugas_id === t.id).map((x) => x.nik) }));
  }

  if (boleh(r, 'log')) out.log = await semua('SELECT waktu, oleh, teks FROM log_aktivitas ORDER BY id DESC LIMIT 300');
  return out;
}
