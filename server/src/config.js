// Peran, hak akses, dan konstanta. Daftar yang sama ada di client/src/app.js untuk menampilkan tombol;
// pemeriksaan yang menentukan ada di sini.
export const LABEL = {
  admin: 'Sekretaris (Admin)', ketua: 'Ketua', hukum: 'Waka Hukum & Advokasi', organisasi: 'Waka Organisasi & Infokom',
  bendahara: 'Bendahara', pendidikan: 'Waka Pendidikan', pkb: 'Waka Pengupahan & PKB', kesos: 'Waka Kesejahteraan Sosial', anggota: 'Anggota'
};

export const IZIN = {
  anggotaUbah: ['admin', 'organisasi'], iuranKelola: ['bendahara'], kasCatat: ['bendahara'], kasValidasi: ['ketua'],
  kasus: ['hukum', 'ketua', 'admin'], kasusProses: ['hukum'], kasusAcc: ['ketua'],
  surat: ['admin', 'ketua', 'hukum'], suratBuat: ['admin'], suratTtd: ['ketua'],
  umumBuat: ['admin', 'ketua', 'organisasi'], pengguna: ['admin'], log: ['admin', 'ketua'],
  diklatKelola: ['pendidikan'], pkbKelola: ['pkb'], sosialKelola: ['kesos'],
  suratMasukCatat: ['admin'], disposisi: ['ketua'], donasiVerif: ['bendahara'], kampanye: ['kesos', 'bendahara'],
  korlapKelola: ['organisasi', 'admin', 'ketua'], gardaKelola: ['organisasi', 'ketua']
};

export const boleh = (peran, kunci) => IZIN[kunci].includes(peran);

// Pengeluaran kas mulai nominal ini menunggu validasi Ketua.
export const BATAS = Number(process.env.BATAS_VALIDASI || 500000);

export const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
export const ROMAWI = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
export const namaPeriode = (tahun, bulan) => `${BULAN[bulan - 1]} ${tahun}`;
export const rp = (n) => 'Rp ' + Number(n).toLocaleString('id-ID');

export class Galat extends Error {
  constructor(pesan, status = 400) { super(pesan); this.status = status; }
}
