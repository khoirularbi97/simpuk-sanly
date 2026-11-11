// SIMPUK: tampilan. Semua data datang dari API (lihat fungsi muat) dan semua perubahan dikirim lewat fungsi aksi.
import qrcode from 'qrcode-generator';
import './style.css';

var today = new Date(); today.setHours(0, 0, 0, 0);

function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function plus(n) { var d = new Date(today); d.setDate(d.getDate() + n); return iso(d); }
function parse(s) { return new Date(s + 'T00:00:00'); }
function tgl(s) { return s ? parse(s).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; }
function sisa(s) { return Math.round((parse(s) - today) / 86400000); }
function rp(n) { return 'Rp ' + Number(n).toLocaleString('id-ID'); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function pill(cls, t) { return '<span class="pill ' + cls + '">' + esc(t) + '</span>'; }

// ---------- Konfigurasi, state, dan sambungan ke API ----------
var API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
var PLANTS = [], DEPTS = [], PERIODE = '';
var LABEL = {
  admin: 'Sekretaris (Admin)', ketua: 'Ketua', hukum: 'Waka Hukum & Advokasi', organisasi: 'Waka Organisasi & Infokom',
  bendahara: 'Bendahara', pendidikan: 'Waka Pendidikan', pkb: 'Waka Pengupahan & PKB', kesos: 'Waka Kesejahteraan Sosial', anggota: 'Anggota'
};
// Daftar ini hanya untuk menampilkan atau menyembunyikan tombol. Pemeriksaan yang menentukan ada di server (server/src/config.js).
var IZIN = {
  anggotaUbah: ['admin', 'organisasi'], iuranKelola: ['bendahara'], kasCatat: ['bendahara'], kasValidasi: ['ketua'],
  kasus: ['hukum', 'ketua', 'admin'], kasusProses: ['hukum'], kasusAcc: ['ketua'],
  surat: ['admin', 'ketua', 'hukum'], suratBuat: ['admin'], suratTtd: ['ketua'],
  umumBuat: ['admin', 'ketua', 'organisasi'], pengguna: ['admin'], log: ['admin', 'ketua'],
  diklatKelola: ['pendidikan'], pkbKelola: ['pkb'], sosialKelola: ['kesos'],
  suratMasukCatat: ['admin'], disposisi: ['ketua'], donasiVerif: ['bendahara'], kampanye: ['kesos', 'bendahara'],
  korlapKelola: ['organisasi', 'admin', 'ketua'], gardaKelola: ['organisasi', 'ketua']
};
var KOSONG = {
  anggota: [], periode: null, periodeList: [], iuranSaya: [], kas: [], kasRingkas: null, log: [], umum: [], aduan: [], surat: [], suratMasuk: [],
  diklat: [], pkb: [], sosial: [], kampanye: [], donasi: [], instruksi: [], aspirasi: [], tugasGarda: []
};
var state = Object.assign({
  user: null, role: 'anggota', wajibGanti: false, memuat: false, periodeKey: '',
  form: null, confirmLock: false, jenis: '', filter: { q: '', plant: '', korlap: '', kar: '', ang: 'aktif' },
  kasForm: false, umumForm: false, hapusUmum: null, suratForm: false, bidangForm: '', ktaNik: null, korlapBuka: null, korlapCabut: null,
  pages: {}, pageSize: 5
}, JSON.parse(JSON.stringify(KOSONG)));

var token = '';
try { token = localStorage.getItem('simpuk-token') || ''; } catch (e) {}
function setToken(t) { token = t; try { if (t) localStorage.setItem('simpuk-token', t); else localStorage.removeItem('simpuk-token'); } catch (e) {} }
function pad2(n) { return String(n).padStart(2, '0'); }
function namaBulan(t, b) { return new Date(t, b - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }); }
function wkt(d) { return d.toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
function isi(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }

async function api(metode, jalur, data) {
  var opsi = { method: metode, headers: {} }, res, json;
  if (token) opsi.headers.Authorization = 'Bearer ' + token;
  if (data instanceof FormData) opsi.body = data;
  else if (data) { opsi.headers['Content-Type'] = 'application/json'; opsi.body = JSON.stringify(data); }
  try { res = await fetch(API + jalur, opsi); } catch (e) { throw new Error('Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.'); }
  try { json = await res.json(); } catch (e) { json = {}; }
  if (!res.ok) { var err = new Error(json.pesan || 'Terjadi kesalahan. Coba lagi.'); err.status = res.status; throw err; }
  return json;
}
// Menerima data dari server dan menyiapkannya untuk tampilan.
function terima(d) {
  Object.assign(state, JSON.parse(JSON.stringify(KOSONG)), d);
  state.log.forEach(function (l) { l.waktu = new Date(l.waktu); });
  if (state.periode) state.periode.waktu = new Date(state.periode.waktu);
  function unik(k) { var s = {}; state.anggota.forEach(function (a) { if (a[k]) s[a[k]] = 1; }); return Object.keys(s).sort(); }
  PLANTS = unik('plant'); DEPTS = unik('dept');
  var pm = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  PERIODE = state.periode ? namaBulan(state.periode.tahun, state.periode.bulan) : namaBulan(pm.getFullYear(), pm.getMonth() + 1);
  if (d.batas) BATAS = d.batas;
}
async function muat() {
  if (!token) { state.user = null; state.memuat = false; render(); return; }
  try { terima(await api('GET', '/api/bootstrap' + (state.periodeKey ? '?p=' + state.periodeKey : ''))); state.gagalMuat = false; }
  catch (e) {
    if (e.status === 401) { setToken(''); state.user = null; state.gagalMuat = false; toast(e.message); }
    else if (!state.user) state.gagalMuat = true;   // masih masuk, tapi server tidak terjangkau: jangan tampilkan form login
    else toast(e.message);
  }
  state.memuat = false;
  render();
}
// Mengirim satu perubahan ke server, lalu memuat ulang data. Kesalahan tampil di kotak galat form (errId) atau sebagai pesan singkat.
async function aksi(nama, data, pesan, errId, bilaBerhasil) {
  try { await api('POST', '/api/aksi/' + nama, data || {}); }
  catch (e) {
    if (e.status === 401) { setToken(''); state.user = null; render(); toast(e.message); }
    else if (errId && document.getElementById(errId)) galat(errId, e.message);
    else toast(e.message);
    return false;
  }
  if (bilaBerhasil) bilaBerhasil();
  await muat();
  if (pesan) toast(pesan);
  return true;
}
function kasSum() { return state.kasRingkas || { masuk: 0, keluar: 0, saldo: 0 }; }
function hitung() {
  var c = { cocok: 0, tidak_terpotong: 0, anomali: 0, bukan_anggota: 0, anggota_tidak_aktif: 0, total: 0, selisih: 0 };
  if (!state.periode) return c;
  state.periode.rows.forEach(function (r) { c[r.status]++; if (r.status !== 'cocok') c.selisih++; });
  c.total = state.periode.total;
  return c;
}
function terkumpul(id) { var k = state.kampanye.find(function (x) { return x.id === id; }); return k ? k.terkumpul : 0; }

function izin(k) { return IZIN[k].indexOf(state.role) >= 0; }
function unsur(a) { return a.isKorlap ? 'Korlap' : (a.garda ? 'Garda Metal' : 'Basis'); }

function byNik(nik) { return state.anggota.find(function (a) { return a.nik === nik; }); }
function namaKorlap(a) { var k = a.korlap && byNik(a.korlap); return k ? k.nama : ''; }
var toastTimer;
function toast(t) { var el = document.getElementById('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.hidden = true; }, 3200); }

var JENIS = { tidak_terpotong: ['bad', 'Tidak terpotong'], anomali: ['warn', 'Anomali nominal'], bukan_anggota: ['vio', 'Bukan anggota'], anggota_tidak_aktif: ['neu', 'Anggota tidak aktif'] };

function karPill(a) { return a.kar === 'pkwtt' ? pill('info', 'PKWTT') : pill('vio', 'PKWT · Kontrak ' + a.kontrakKe); }
function angPill(a) { return a.status === 'aktif' ? pill('ok', 'Aktif') : pill('neu', a.status === 'keluar' ? 'Keluar' : 'Nonaktif'); }
function sisaPill(d) { return d < 0 ? pill('bad', 'Lewat ' + (-d) + ' hari') : pill(d <= 7 ? 'bad' : 'warn', d + ' hari'); }

// ---------- Dashboard ----------
function vDashboard() {
  var aktif = state.anggota.filter(function (a) { return a.status === 'aktif'; });
  var pkwt = aktif.filter(function (a) { return a.kar === 'pkwt'; });
  var c = hitung();
  var habis = pkwt.filter(function (a) { return a.akhir && sisa(a.akhir) <= 30; }).sort(function (x, y) { return x.akhir < y.akhir ? -1 : 1; });
  var perPlant = PLANTS.map(function (p) { return aktif.filter(function (a) { return a.plant === p; }).length; });
  var max = Math.max.apply(null, perPlant.concat([1]));
  var iuranKpi = state.periode
    ? '<div class="v num">' + rp(c.total) + '</div><div>' + (state.periode.status === 'terkunci' ? pill('ok', 'Terkunci') : pill('warn', 'Draf, belum dikunci')) + '</div>'
    : '<div class="v">Belum diimpor</div><a href="#iuran" class="small">Buka halaman Iuran</a>';
  function ico(p) { return '<span class="ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg></span>'; }
  var I = {
    people: ico('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18.5 14.8c1.7.8 2.7 2.4 3 5.2"/>'),
    kerja: ico('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>'),
    dompet: ico('<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M16 12.5h2M3 10h18"/>'),
    awas: ico('<path d="M12 4 2.8 19.5h18.4L12 4Z"/><path d="M12 10v4.5M12 17.2v.3"/>')
  };
  var jam = new Date().getHours();
  var salam = (jam < 11 ? 'Selamat pagi' : jam < 15 ? 'Selamat siang' : jam < 18 ? 'Selamat sore' : 'Selamat malam') + ', ' + esc(state.user.nama.split(' ')[0]);
  var pct = state.periode && aktif.length ? Math.round(c.cocok / aktif.length * 100) : 0;
  var judul = !state.periode ? 'Rekap iuran belum diimpor' : c.cocok + ' dari ' + aktif.length + ' anggota aktif terpotong sesuai';
  var ketHero = !state.periode ? 'Impor rekap HR untuk mencocokkan potongan gaji dengan data anggota.' : (state.periode.status === 'terkunci' ? 'Periode sudah dikunci dan totalnya masuk ke kas.' : 'Periode masih draf. Tinjau selisih lalu kunci periodenya.');
  var hero = '<section class="glass hero wide"><div class="hero-t"><span class="chip">Iuran ' + esc(PERIODE) + '</span><h2>' + judul + '</h2><p>' + ketHero + '</p>' +
    '<div class="hero-s"><div><b class="num">' + c.tidak_terpotong + '</b><span>tidak terpotong</span></div><div><b class="num">' + c.anomali + '</b><span>anomali</span></div><div><b class="num">' + habis.length + '</b><span>kontrak habis</span></div></div>' +
    '<div class="row"><a class="btn" href="#iuran">Buka Iuran</a><a class="btn ghost" href="#anggota">Kelola anggota</a></div></div>' +
    '<svg class="ring" viewBox="0 0 120 120" role="img" aria-label="' + pct + ' persen anggota aktif terpotong sesuai"><circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="9"/>' +
    (pct > 0 ? '<circle cx="60" cy="60" r="50" fill="none" stroke="#FFFFFF" stroke-width="9" stroke-linecap="round" stroke-dasharray="' + (3.1416 * pct).toFixed(1) + ' 400" transform="rotate(-90 60 60)"/>' : '') +
    '<text x="60" y="58" text-anchor="middle" font-size="24" font-weight="700" fill="#FFFFFF" font-family="Space Grotesk, sans-serif">' + pct + '%</text><text x="60" y="76" text-anchor="middle" font-size="10" fill="#FFFFFF">cocok</text></svg></section>';
  var dn = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  var senin = new Date(today); senin.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  var minggu = '';
  for (var wi = 0; wi < 7; wi++) { var wd = new Date(senin); wd.setDate(senin.getDate() + wi); minggu += '<div' + (iso(wd) === iso(today) ? ' class="now"' : '') + '><small>' + dn[wd.getDay()] + '</small>' + wd.getDate() + '</div>'; }
  var agenda = habis.slice(0, 2).map(function (a) { return '<div class="agenda"><time>' + parse(a.akhir).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) + '</time><span class="bar"></span><div style="min-width:0"><div class="nm">' + esc(a.nama) + '</div><div class="small muted">Kontrak ' + a.kontrakKe + ' berakhir</div></div></div>'; }).join('') || '<p class="small muted">Tidak ada kontrak yang berakhir dalam 30 hari.</p>';
  var tglCard = '<section class="glass pad narrow stack"><div class="row" style="flex-wrap:nowrap"><div class="daynum num">' + String(today.getDate()).padStart(2, '0') + '</div><div><div class="nm" style="font-size:18px">' + today.toLocaleDateString('id-ID', { weekday: 'long' }) + '</div><div class="small muted">' + today.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) + ' · ' + habis.length + ' kontrak segera habis</div></div></div><div class="week">' + minggu + '</div>' + agenda + '</section>';
  var nSel = state.periode ? c.selisih : 0;
  return '' +
    '<div class="head"><div><h1>' + salam + '</h1><p class="muted">' + today.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + '</p></div><div class="row">' + (izin('log') ? '<a class="btn" href="#log">Log aktivitas</a>' : '') + '<a class="btn dark" href="#anggota">Data anggota</a></div></div>' +
    '<div class="cols eq">' + hero + tglCard + '</div>' + tugasHtml() + '<section class="kpis" aria-label="Ringkasan">' +
      '<div class="glass kpi"><div class="top">' + I.people + '<span class="tag">' + PLANTS.length + ' plant</span></div><div class="v num">' + aktif.length + '</div><div class="lbl">Anggota aktif</div><div class="small muted">' + (state.anggota.length - aktif.length) + ' nonaktif atau keluar</div></div>' +
      '<div class="glass kpi"><div class="top">' + I.kerja + '<span class="tag">' + pkwt.length + ' PKWT</span></div><div class="v num">' + (aktif.length - pkwt.length) + '</div><div class="lbl">Karyawan PKWTT</div><div class="small muted">' + habis.length + ' kontrak PKWT segera habis</div></div>' +
      '<div class="glass kpi hot"><div class="top">' + I.dompet + '<span class="tag">' + (state.periode ? (state.periode.status === 'terkunci' ? 'Terkunci' : 'Draf') : 'Belum diimpor') + '</span></div><div class="v num">' + (state.periode ? rp(c.total) : 'Rp 0') + '</div><div class="lbl">Iuran ' + esc(PERIODE) + '</div><a href="#iuran" class="small">Buka halaman Iuran</a></div>' +
      '<div class="glass kpi"><div class="top">' + I.awas + '<span class="tag' + (nSel ? ' warn' : '') + '">' + (nSel ? 'Perlu ditinjau' : 'Tidak ada') + '</span></div><div class="v num">' + nSel + '</div><div class="lbl">Selisih iuran</div><a href="#iuran" class="small">Tinjau di halaman Iuran</a></div>' +
    '</section>' +
    '<div class="cols">' +
      '<section class="glass wide"><div class="pad"><h2>Kontrak PKWT segera habis</h2><p class="small muted">Dalam 30 hari ke depan atau sudah lewat</p></div>' +
        (habis.length ? '<div class="tablewrap"><table><thead><tr><th>Nama</th><th>Plant</th><th>Korlap</th><th>Kontrak</th><th>Berakhir</th><th>Sisa</th></tr></thead><tbody>' +
          habis.map(function (a) { return '<tr><td><div class="nm">' + esc(a.nama) + '</div><div class="small muted num">' + esc(a.nik) + '</div></td><td>' + esc(a.plant) + '</td><td>' + esc(namaKorlap(a)) + '</td><td>Kontrak ' + a.kontrakKe + '</td><td>' + tgl(a.akhir) + '</td><td>' + sisaPill(sisa(a.akhir)) + '</td></tr>'; }).join('') +
          '</tbody></table></div>' : '<div class="empty">Tidak ada kontrak yang habis dalam 30 hari.</div>') +
      '</section>' +
      '<div class="narrow" style="display:flex;flex-direction:column;gap:16px">' +
        '<section class="glass pad"><h2>Anggota aktif per plant</h2><ul class="list" style="margin-top:14px">' +
          PLANTS.map(function (p, i) { return '<li><div class="head"><span>' + p + '</span><span class="nm num">' + perPlant[i] + '</span></div><div class="bar" style="margin-top:6px"><i style="width:' + Math.round(perPlant[i] / max * 100) + '%"></i></div></li>'; }).join('') +
        '</ul></section>' +
        (izin('log') ? '<section class="glass pad"><h2>Aktivitas terbaru</h2>' +
          (state.log.length ? '<ul class="list" style="margin-top:14px">' + state.log.slice(0, 6).map(function (l) { return '<li><div>' + esc(l.teks) + '</div><div class="small muted">' + wkt(l.waktu) + ' oleh ' + esc(l.oleh) + '</div></li>'; }).join('') + '</ul>'
            : '<p class="muted" style="margin-top:10px">Belum ada aktivitas.</p>') +
        '</section>' : '') +
      '</div>' +
    '</div>';
}

// ---------- Anggota ----------
function opt(v, t, sel) { return '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') + '>' + esc(t) + '</option>'; }
// ---------- Impor data anggota dari Excel ----------
var KOLOM_TEMPLAT = ['NIK', 'Nama', 'Departemen', 'Plant', 'Status karyawan', 'Kontrak ke', 'Akhir kontrak', 'Mulai bekerja', 'Tanggal gabung', 'No HP', 'Garda Metal', 'Keanggotaan'];
function vImporAnggota() {
  var h = state.impangHasil;
  var form = '<form id="frmimpang" class="glass pad stack" novalidate><div class="head"><h2>Impor data anggota dari Excel</h2><button type="button" class="btn" data-act="impang-templat">Unduh templat</button></div>' +
    '<p class="small muted">File .xlsx atau .csv dengan baris judul. Wajib ada kolom <b>NIK</b> dan <b>Nama</b>. Untuk anggota baru juga wajib: Departemen, Plant, Status karyawan (PKWT/PKWTT), Kontrak ke (khusus PKWT), dan Mulai bekerja. ' +
    'Kolom lain boleh ada: Akhir kontrak, Tanggal gabung, No HP, Garda Metal, Keanggotaan. Tanggal ditulis seperti 31/12/2026.</p>' +
    '<p class="small muted">NIK yang sudah terdaftar akan diperbarui sesuai isi file; sel yang kosong tidak mengubah data lama. Peran, sandi, nomor KTA, dan korlap tidak ikut berubah. Anggota baru masuk dengan sandi awal dan wajib menggantinya.</p>' +
    '<div id="impang-err" class="err" role="alert" hidden></div>' +
    '<div class="row" style="align-items:flex-end">' + fld('ia-file', 'File data anggota', '<input id="ia-file" type="file" accept=".xlsx,.csv" style="padding:9px 12px">', true) + '</div>' +
    (state.impangFile ? '<p class="small">File dipilih: <span class="nm">' + esc(state.impangFile.name) + '</span></p>' : '') +
    '<div class="row"><button type="submit" class="btn primary" id="ia-periksa">Periksa file</button><button type="button" class="btn" data-act="impang-tutup">Tutup</button></div></form>';
  if (!h) return form;
  function tabel(judul, kepala, baris) {
    return '<section class="glass"><div class="pad"><h2>' + judul + '</h2></div><div class="tablewrap"><table><thead><tr>' + kepala.map(function (k) { return '<th>' + k + '</th>'; }).join('') + '</tr></thead><tbody>' + baris.join('') + '</tbody></table></div></section>';
  }
  function lebih(n, tampil) { return n > tampil ? '<p class="small muted" style="padding:0 4px">Menampilkan ' + tampil + ' dari ' + n + ' baris.</p>' : ''; }
  var siap = h.jumlahBaru + h.jumlahDiperbarui;
  return form +
    '<section class="kpis" aria-label="Hasil pemeriksaan" style="--kpi-h:0">' +
      '<div class="glass kpi"><div class="small muted">Anggota baru</div><div class="v num">' + h.jumlahBaru + '</div></div>' +
      '<div class="glass kpi"><div class="small muted">Diperbarui</div><div class="v num">' + h.jumlahDiperbarui + '</div></div>' +
      '<div class="glass kpi"><div class="small muted">Tanpa perubahan</div><div class="v num">' + h.tetap + '</div></div>' +
      '<div class="glass kpi' + (h.jumlahGalat ? ' hot' : '') + '"><div class="small muted">Dilewati karena salah</div><div class="v num">' + h.jumlahGalat + '</div></div>' +
    '</section>' +
    '<p class="small" style="padding:0 4px">Kolom yang terbaca: ' + esc(h.kolom.join(', ')) + '.</p>' +
    (h.galat.length ? tabel('Baris yang dilewati', ['Baris', 'NIK', 'Nama', 'Alasan'], h.galat.map(function (g) { return '<tr><td class="num">' + g.baris + '</td><td class="num">' + esc(g.nik || '-') + '</td><td>' + esc(g.nama || '-') + '</td><td>' + esc(g.pesan) + '</td></tr>'; })) + lebih(h.jumlahGalat, h.galat.length) : '') +
    (h.baru.length ? tabel('Anggota baru', ['NIK', 'Nama', 'Departemen', 'Plant', 'Status karyawan'], h.baru.map(function (a) { return '<tr><td class="num">' + esc(a.nik) + '</td><td><span class="nm">' + esc(a.nama) + '</span></td><td>' + esc(a.dept) + '</td><td>' + esc(a.plant) + '</td><td>' + (a.kar === 'pkwtt' ? pill('info', 'PKWTT') : pill('vio', 'PKWT · Kontrak ' + a.ke)) + '</td></tr>'; })) + lebih(h.jumlahBaru, h.baru.length) : '') +
    (h.diperbarui.length ? tabel('Anggota yang diperbarui', ['NIK', 'Nama', 'Kolom yang berubah'], h.diperbarui.map(function (a) { return '<tr><td class="num">' + esc(a.nik) + '</td><td><span class="nm">' + esc(a.nama) + '</span></td><td>' + esc(a.kolom.join(', ')) + '</td></tr>'; })) + lebih(h.jumlahDiperbarui, h.diperbarui.length) : '') +
    '<section class="glass pad head"><div style="flex:1 1 300px"><div class="nm">' + (siap ? 'Simpan ' + siap + ' perubahan?' : 'Tidak ada yang perlu disimpan') + '</div><p class="small muted">' +
      (siap ? h.jumlahBaru + ' anggota baru dan ' + h.jumlahDiperbarui + ' pembaruan.' + (h.jumlahGalat ? ' Baris yang salah tidak ikut disimpan; perbaiki di Excel lalu impor lagi.' : '') : 'Semua NIK di file sudah sesuai dengan data, atau semua barisnya salah.') + '</p></div>' +
      '<button type="button" class="btn primary" data-act="impang-simpan"' + (siap ? '' : ' disabled') + '>Simpan ke data anggota</button></section>';
}
async function periksaImporAnggota(simpan) {
  var input = document.getElementById('ia-file');
  if (input && input.files[0]) state.impangFile = input.files[0];
  if (!state.impangFile) { galat('impang-err', 'Pilih file data anggota terlebih dahulu.'); return; }
  var tombol = document.querySelector(simpan ? '[data-act=impang-simpan]' : '#ia-periksa');
  if (tombol) { tombol.disabled = true; tombol.textContent = simpan ? 'Menyimpan…' : 'Memeriksa…'; }
  var fd = new FormData(); fd.append('file', state.impangFile); if (simpan) fd.append('simpan', '1');
  var h;
  try { h = await api('POST', '/api/anggota/impor', fd); }
  catch (e) {
    if (tombol) { tombol.disabled = false; tombol.textContent = simpan ? 'Simpan ke data anggota' : 'Periksa file'; }
    if (e.status === 401) { setToken(''); state.user = null; render(); toast(e.message); return; }
    galat('impang-err', e.message); return;
  }
  if (!simpan) { state.impangHasil = h; render(); return; }
  state.impang = false; state.impangHasil = null; state.impangFile = null; state.pages = {};
  await muat();
  toast(h.jumlahBaru + ' anggota ditambahkan, ' + h.jumlahDiperbarui + ' diperbarui');
}
function unduhTemplat() {
  var baris = [KOLOM_TEMPLAT,
    ['CONTOH', 'Contoh Anggota Kontrak (hapus baris ini)', 'Injection', 'Plant 1', 'PKWT', '1', '31/12/2026', '06/01/2025', '01/04/2025', '081200000000', 'Tidak', 'Aktif'],
    ['CONTOH', 'Contoh Anggota Tetap (hapus baris ini)', 'Painting', 'Plant 2', 'PKWTT', '', '', '18/04/2016', '01/08/2016', '', 'Ya', 'Aktif']];
  var csv = 'sep=;\r\n' + baris.map(function (b) { return b.join(';'); }).join('\r\n') + '\r\n';
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'templat-data-anggota-simpuk.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
}

function vAnggota() {
  var f = state.filter;
  var korlaps = state.anggota.filter(function (a) { return state.anggota.some(function (b) { return b.korlap === a.nik; }); });
  return '' +
    '<div class="head"><div><h1>Data Anggota</h1><p class="muted" id="ringkas"></p></div>' +
      (izin('anggotaUbah') ? '<div class="row"><button type="button" class="btn" data-act="impang-buka">Impor dari Excel</button><button type="button" class="btn primary" data-act="tambah">Tambah anggota</button></div>' : '') + '</div>' +
    (izin('anggotaUbah') && state.impang ? vImporAnggota() : '') +
    '<div id="formslot">' + (state.form ? vForm() : '') + '</div>' +
    '<section class="glass pad row" aria-label="Filter" style="align-items:flex-end">' +
      '<div class="field grow"><label for="f-q">Cari</label><input id="f-q" type="search" placeholder="Nama atau NIK" value="' + esc(f.q) + '"></div>' +
      '<div class="field"><label for="f-plant">Plant</label><select id="f-plant">' + opt('', 'Semua plant', f.plant) + PLANTS.map(function (p) { return opt(p, p, f.plant); }).join('') + '</select></div>' +
      '<div class="field"><label for="f-korlap">Korlap</label><select id="f-korlap">' + opt('', 'Semua korlap', f.korlap) + korlaps.map(function (k) { return opt(k.nik, k.nama, f.korlap); }).join('') + '</select></div>' +
      '<div class="field"><label for="f-kar">Status karyawan</label><select id="f-kar">' + opt('', 'Semua', f.kar) + opt('pkwt', 'PKWT', f.kar) + opt('pkwtt', 'PKWTT', f.kar) + '</select></div>' +
      '<div class="field"><label for="f-ang">Keanggotaan</label><select id="f-ang">' + opt('aktif', 'Aktif', f.ang) + opt('nonaktif', 'Nonaktif', f.ang) + opt('keluar', 'Keluar', f.ang) + opt('', 'Semua', f.ang) + '</select></div>' +
    '</section>' +
    '<section class="glass" id="tabel"></section>';
}
function tabelAnggota() {
  var f = state.filter, q = f.q.trim().toLowerCase();
  var rows = state.anggota.filter(function (a) {
    return (!q || a.nama.toLowerCase().indexOf(q) >= 0 || a.nik.indexOf(q) >= 0) &&
      (!f.plant || a.plant === f.plant) && (!f.korlap || a.korlap === f.korlap) &&
      (!f.kar || a.kar === f.kar) && (!f.ang || a.status === f.ang);
  });
  var el = document.getElementById('tabel'); if (!el) return;
  var aktif = state.anggota.filter(function (a) { return a.status === 'aktif'; }).length;
  document.getElementById('ringkas').textContent = aktif + ' anggota aktif, ' + (state.anggota.length - aktif) + ' nonaktif atau keluar';
  el.innerHTML = rows.length ? '<div class="tablewrap"><table><thead><tr><th>Anggota</th><th>Departemen</th><th>Plant</th><th>Korlap</th><th>Status karyawan</th><th>Akhir kontrak</th><th>Mulai bekerja</th><th>Keanggotaan</th><th>Aksi</th></tr></thead><tbody>' +
    rows.map(function (a) {
      var ak = a.kar === 'pkwt' ? (a.akhir ? tgl(a.akhir) + (sisa(a.akhir) <= 30 ? ' ' + sisaPill(sisa(a.akhir)) : '') : '<span class="muted">Belum diisi</span>') : '<span class="muted">Tidak ada</span>';
      return '<tr><td><div class="nm">' + esc(a.nama) + '</div><div class="small muted num">' + esc(a.nik) + ' · ' + esc(a.kta) + ' · ' + unsur(a) + '</div></td><td>' + esc(a.dept) + '</td><td>' + esc(a.plant) + '</td><td>' + (esc(namaKorlap(a)) || '<span class="muted">Tidak ada</span>') + '</td><td>' + karPill(a) + '</td><td>' + ak + '</td><td>' + tgl(a.mulai) + '</td><td>' + angPill(a) + '</td><td><button type="button" class="linkbtn" data-act="bd-kta" data-nik="' + esc(a.nik) + '">KTA</button> ' + (izin('anggotaUbah') ? '<button type="button" class="linkbtn" data-act="ubah" data-nik="' + esc(a.nik) + '">Ubah</button>' : '<span class="muted">Hanya lihat</span>') + '</td></tr>';
    }).join('') + '</tbody></table></div>'
    : '<div class="empty">Tidak ada anggota yang cocok dengan filter ini.</div>';
  tabelPintar();
}
function vForm() {
  var e = state.form, a = e.data, baru = !e.nik;
  var calon = state.anggota.filter(function (x) { return x.status === 'aktif' && x.nik !== e.nik; });
  return '<form id="frm" class="glass pad" novalidate style="display:flex;flex-direction:column;gap:14px">' +
    '<h2>' + (baru ? 'Tambah anggota' : 'Ubah data ' + esc(a.nama)) + '</h2>' +
    '<div id="frm-err" class="err" role="alert" hidden></div>' +
    '<div class="row" style="align-items:flex-end">' +
      '<div class="field"><label for="a-nik">NIK karyawan</label><input id="a-nik" inputmode="numeric" value="' + esc(a.nik) + '"' + (baru ? '' : ' disabled') + '></div>' +
      '<div class="field grow"><label for="a-nama">Nama</label><input id="a-nama" value="' + esc(a.nama) + '"></div>' +
      '<div class="field"><label for="a-dept">Departemen</label><input id="a-dept" list="dl-dept" value="' + esc(a.dept) + '"><datalist id="dl-dept">' + DEPTS.map(function (d) { return '<option value="' + esc(d) + '"></option>'; }).join('') + '</datalist></div>' +
      '<div class="field"><label for="a-plant">Plant</label><input id="a-plant" list="dl-plant" value="' + esc(a.plant) + '"><datalist id="dl-plant">' + PLANTS.map(function (p) { return '<option value="' + esc(p) + '"></option>'; }).join('') + '</datalist></div>' +
      '<div class="field"><label for="a-hp">No. HP (boleh kosong)</label><input id="a-hp" inputmode="tel" value="' + esc(a.hp || '') + '"></div>' +
      '<div class="field"><span class="small muted nm">Korlap</span><div style="min-height:44px;display:flex;flex-wrap:wrap;align-items:center;gap:6px"><span class="nm">' + (esc(namaKorlap(a)) || 'Belum ada') + '</span><span class="small muted">diatur di modul Korlap</span></div></div>' +
    '</div>' +
    '<div class="row" style="align-items:flex-end">' +
      '<div class="field"><label for="a-kar">Status karyawan</label><select id="a-kar">' + opt('pkwtt', 'PKWTT', a.kar) + opt('pkwt', 'PKWT', a.kar) + '</select></div>' +
      '<div class="field" id="w-ke"' + (a.kar === 'pkwt' ? '' : ' hidden') + '><label for="a-ke">Kontrak ke</label><input id="a-ke" type="number" min="1" step="1" value="' + esc(a.kontrakKe || '') + '"></div>' +
      '<div class="field" id="w-akhir"' + (a.kar === 'pkwt' ? '' : ' hidden') + '><label for="a-akhir">Akhir kontrak (boleh kosong)</label><input id="a-akhir" type="date" value="' + esc(a.akhir) + '"></div>' +
      '<div class="field"><label for="a-mulai">Mulai bekerja</label><input id="a-mulai" type="date" value="' + esc(a.mulai) + '"></div>' +
      '<div class="field"><label for="a-gabung">Gabung PUK</label><input id="a-gabung" type="date" value="' + esc(a.gabung) + '"></div>' +
      '<div class="field"><label for="a-status">Keanggotaan</label><select id="a-status">' + opt('aktif', 'Aktif', a.status) + opt('nonaktif', 'Nonaktif', a.status) + opt('keluar', 'Keluar', a.status) + '</select></div>' +
      '<div class="field"><label for="a-garda">Garda Metal</label><select id="a-garda">' + opt('0', 'Bukan', a.garda ? '1' : '0') + opt('1', 'Ya', a.garda ? '1' : '0') + '</select></div>' +
    '</div>' +
    '<div class="row"><button type="submit" class="btn primary">Simpan</button><button type="button" class="btn" data-act="batal">Batal</button></div>' +
    '</form>';
}
function val(id) { return document.getElementById(id).value.trim(); }

// ---------- Iuran ----------
function vIuran() {
  var p = state.periode, bend = izin('iuranKelola'), c = hitung();
  var kunciP = p ? p.tahun + '-' + pad2(p.bulan) : '';
  var pilih = state.periodeList.length > 1 ? '<div class="field" style="flex:0 1 200px"><label for="f-periode">Periode</label><select id="f-periode">' +
    state.periodeList.map(function (x) { var k = x.tahun + '-' + pad2(x.bulan); return opt(k, namaBulan(x.tahun, x.bulan), kunciP); }).join('') + '</select></div>' : '';
  var head = '<div class="head"><div><h1>Iuran ' + esc(PERIODE) + '</h1><p class="muted">Potongan gaji otomatis, dicocokkan dengan rekap dari HR</p></div><div class="row" style="align-items:flex-end">' + pilih +
    (p ? (p.status === 'terkunci' ? pill('ok', 'Terkunci') : pill('warn', 'Draf')) : pill('neu', 'Belum diimpor')) + '</div></div>';
  if (!bend) head += '<div class="note">Nominal per orang hanya terlihat oleh bendahara. Impor dan penguncian juga hanya bisa dilakukan bendahara.</div>';
  var pm = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  var formImpor = !bend ? '' : '<form id="frmimpor" class="glass pad stack" novalidate><h2>Impor rekap potongan dari HR</h2>' +
    '<p class="small muted">File Excel (.xlsx) atau CSV dengan kolom NIK, Nama, dan Nominal potongan. Mengimpor ulang periode yang masih draf mengganti datanya; catatan per NIK dipertahankan.</p>' +
    '<div id="impor-err" class="err" role="alert" hidden></div><div class="row" style="align-items:flex-end">' +
    fld('i-bulan', 'Periode', '<input id="i-bulan" type="month" value="' + pm.getFullYear() + '-' + pad2(pm.getMonth() + 1) + '">') +
    fld('i-file', 'File rekap', '<input id="i-file" type="file" accept=".xlsx,.csv" style="padding:9px 12px">', true) + '</div>' +
    '<div><button type="submit" class="btn primary">Impor dan cocokkan</button></div></form>';
  if (!p) return head + (bend ? formImpor : '<section class="glass"><div class="empty">Belum ada rekap iuran yang diimpor.</div></section>');
  var kunci = p.status === 'terkunci';
  var sel = p.rows.filter(function (r) { return r.status !== 'cocok' && (!state.jenis || r.status === state.jenis); });
  var tanpa = p.rows.filter(function (r) { return r.status !== 'cocok' && !r.catatan; }).length;
  function k(label, n) { return '<div class="glass kpi"><div class="small muted">' + label + '</div><div class="v num">' + n + '</div></div>'; }
  return head +
    '<section class="glass pad head"><div><div class="nm">' + esc(p.namaFile || 'Rekap HR') + '</div><div class="small muted">' + p.jumlahHr + ' baris dari HR, diimpor ' + wkt(p.waktu) + '</div></div>' +
      '<button type="button" class="btn" data-act="impor-ulang"' + (bend && !kunci ? '' : ' disabled') + '>Cocokkan ulang</button></section>' +
    '<section class="kpis" aria-label="Hasil pencocokan">' + k('Cocok', c.cocok) + k('Tidak terpotong', c.tidak_terpotong) + k('Anomali nominal', c.anomali) + k('Bukan anggota', c.bukan_anggota) + k('Anggota tidak aktif', c.anggota_tidak_aktif) +
      '<div class="glass kpi hot"><div class="small muted">Total iuran</div><div class="v num" style="font-size:22px">' + rp(c.total) + '</div></div></section>' +
    '<section class="glass"><div class="pad head"><div><h2>Selisih yang perlu ditinjau</h2><p class="small muted">' + c.selisih + ' baris, ' + tanpa + ' belum diberi catatan</p></div>' +
      '<div class="field" style="flex:0 1 220px"><label for="f-jenis">Jenis selisih</label><select id="f-jenis">' + opt('', 'Semua', state.jenis) + Object.keys(JENIS).map(function (j) { return opt(j, JENIS[j][1] + ' (' + c[j] + ')', state.jenis); }).join('') + '</select></div></div>' +
      (sel.length ? '<div class="tablewrap"><table><thead><tr><th>NIK dan nama</th><th class="r">Nominal</th><th>Jenis selisih</th><th>Keterangan sistem</th><th>Catatan bendahara</th></tr></thead><tbody>' +
        sel.map(function (r) {
          var nom = r.sembunyi ? '<span class="muted">Disembunyikan</span>' : (r.nominal == null ? '<span class="muted">Tidak ada</span>' : '<span class="nm num">' + rp(r.nominal) + '</span>');
          var cat = (bend && !kunci) ? '<input id="cat-' + r.id + '" data-cat="' + r.id + '" aria-label="Catatan untuk ' + esc(r.nama) + '" placeholder="Tulis catatan" value="' + esc(r.catatan) + '" style="min-width:180px">' : (esc(r.catatan) || '<span class="muted">Belum ada</span>');
          return '<tr><td><div class="nm">' + esc(r.nama || 'Tanpa nama') + '</div><div class="small muted num">' + esc(r.nik) + '</div></td><td class="r">' + nom + '</td><td>' + pill(JENIS[r.status][0], JENIS[r.status][1]) + '</td><td>' + esc(r.ket) + '</td><td>' + cat + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="empty">Tidak ada selisih untuk jenis ini.</div>') +
    '</section>' +
    (kunci ? '<section class="glass pad"><div class="nm">Periode ' + esc(PERIODE) + ' sudah dikunci</div><p class="small muted">Data iuran bulan ini tidak bisa diubah lagi dan totalnya sudah masuk ke kas.</p></section>'
      : '<section class="glass pad head"><div style="flex:1 1 300px"><div class="nm">Kunci periode ' + esc(PERIODE) + '</div><p class="small muted">Setelah dikunci, data iuran bulan ini tidak bisa diubah dan totalnya masuk ke kas.' + (tanpa ? ' Masih ada ' + tanpa + ' baris tanpa catatan.' : '') + '</p></div>' +
        (state.confirmLock ? '<div class="row"><span class="nm">Kunci sekarang?</span><button type="button" class="btn primary" data-act="kunci-ya">Ya, kunci</button><button type="button" class="btn" data-act="kunci-batal">Batal</button></div>'
          : '<button type="button" class="btn primary" data-act="kunci"' + (bend ? '' : ' disabled') + '>Kunci periode</button>') + '</section>') +
    formImpor;
}

// ---------- Login ----------
// ---------- PWA: pasang aplikasi dan status offline ----------
var promptPasang = null;
function terpasang() { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }
function iOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
function vPasang() {
  if (terpasang()) return '';
  if (promptPasang) return '<section class="glass pad head"><div style="flex:1 1 240px"><div class="nm">Pasang SIMPUK di perangkat ini</div><p class="small muted">Buka langsung dari layar utama, tanpa membuka browser.</p></div><button type="button" class="btn primary" data-act="pasang">Pasang aplikasi</button></section>';
  if (iOS()) return '<section class="glass pad"><div class="nm">Pasang SIMPUK di iPhone atau iPad</div><p class="small muted">Buka halaman ini di Safari, tekan tombol Bagikan, lalu pilih Tambahkan ke Layar Utama.</p></section>';
  return '';
}
async function pasang() {
  if (!promptPasang) return;
  promptPasang.prompt();
  try { await promptPasang.userChoice; } catch (e) {}
  promptPasang = null; render();
}
window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); promptPasang = e; render(); });
window.addEventListener('appinstalled', function () { promptPasang = null; render(); toast('SIMPUK terpasang di perangkat ini'); });
function cekOnline() { var el = document.getElementById('offline'); if (el) el.hidden = navigator.onLine; }
window.addEventListener('online', function () { cekOnline(); if (token) muat(); });
window.addEventListener('offline', cekOnline);
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
}

function vLogin() {
  var logo = '<div class="logobox"><img src="/logo-full.png" alt="SIMPUK SPAMK FSPMI PT. Sanly Industries"></div>';
  if (token && state.gagalMuat && !state.memuat) return logo + '<section class="glass pad stack" style="text-align:center"><h2>Tidak bisa terhubung ke server</h2>' +
    '<p class="muted">' + (navigator.onLine ? 'Server mungkin sedang bangun atau ada gangguan. Coba lagi sebentar lagi.' : 'Perangkat sedang offline. Data akan dimuat otomatis setelah tersambung.') + '</p>' +
    '<div class="row" style="justify-content:center"><button type="button" class="btn primary" data-act="coba-lagi">Coba lagi</button><button type="button" class="btn" data-act="keluar">Keluar</button></div></section>';
  if (state.memuat) return logo + '<section class="glass"><div class="empty">Memuat data. Bila server baru bangun, ini bisa sampai satu menit.</div></section>';
  return logo + '<div class="head"><div><h1>Masuk ke SIMPUK</h1><p class="muted">Gunakan NIK karyawan dan sandi Anda</p></div></div>' +
    '<form id="login" class="glass pad" novalidate style="display:flex;flex-direction:column;gap:14px">' +
      '<div id="login-err" class="err" role="alert" hidden></div>' +
      '<div class="field"><label for="l-nik">NIK karyawan</label><input id="l-nik" inputmode="numeric" autocomplete="username"></div>' +
      '<div class="field"><label for="l-sandi">Sandi</label><input id="l-sandi" type="password" autocomplete="current-password"></div>' +
      '<button type="submit" class="btn primary" id="l-kirim">Masuk</button>' +
    '</form>' +
    '<p class="small muted" style="text-align:center">Belum punya akun atau lupa sandi? Hubungi Sekretaris PUK.</p>' + vPasang();
}

// ---------- Akun dan ganti sandi ----------
function vAkun() {
  return '<div class="head"><div><h1>Akun</h1><p class="muted">' + esc(state.user.nama) + ' · NIK ' + esc(state.user.nik) + ' · ' + LABEL[state.role] + '</p></div></div>' +
    (state.wajibGanti ? '<div class="note">Anda masih memakai sandi awal. Ganti sandi dulu untuk membuka menu lain.</div>' : '') +
    '<form id="frmsandi" class="glass pad stack" novalidate style="max-width:460px"><h2>Ganti sandi</h2><div id="sandi-err" class="err" role="alert" hidden></div>' +
    '<div class="field"><label for="p-lama">Sandi sekarang</label><input id="p-lama" type="password" autocomplete="current-password"></div>' +
    '<div class="field"><label for="p-baru">Sandi baru (minimal 8 karakter)</label><input id="p-baru" type="password" autocomplete="new-password"></div>' +
    '<div class="field"><label for="p-ulang">Ulangi sandi baru</label><input id="p-ulang" type="password" autocomplete="new-password"></div>' +
    '<div><button type="submit" class="btn primary">Simpan sandi baru</button></div></form>' + vPasang();
}

// ---------- Kas ----------
var KAT = ['Iuran', 'Rapat', 'Santunan', 'Administrasi', 'Kegiatan', 'Advokasi', 'Lainnya'];
var BATAS = 500000; // pengeluaran mulai nominal ini perlu validasi Ketua
var ST_KAS = { sah: ['ok', 'Sah'], menunggu: ['warn', 'Menunggu Ketua'], ditolak: ['neu', 'Ditolak'] };
function galat(id, msg) { var b = document.getElementById(id); if (b) { b.textContent = msg; b.hidden = false; } }
function vKas() {
  var s = kasSum(), bend = izin('kasCatat'), ketua = izin('kasValidasi');
  var rows = state.kas.slice().sort(function (a, b) { return a.tgl < b.tgl ? 1 : -1; });
  var form = '<form id="frmkas" class="glass pad" novalidate style="display:flex;flex-direction:column;gap:14px"><h2>Catat transaksi</h2>' +
    '<p class="small muted">Pengeluaran mulai ' + rp(BATAS) + ' perlu divalidasi Ketua sebelum mengurangi saldo.</p>' +
    '<div id="kas-err" class="err" role="alert" hidden></div><div class="row" style="align-items:flex-end">' +
    '<div class="field"><label for="k-tgl">Tanggal</label><input id="k-tgl" type="date" value="' + iso(today) + '"></div>' +
    '<div class="field"><label for="k-jenis">Jenis</label><select id="k-jenis"><option value="keluar">Pengeluaran</option><option value="masuk">Pemasukan</option></select></div>' +
    '<div class="field"><label for="k-kat">Kategori</label><select id="k-kat">' + KAT.map(function (k) { return opt(k, k, 'Rapat'); }).join('') + '</select></div>' +
    '<div class="field grow"><label for="k-ket">Keterangan</label><input id="k-ket"></div>' +
    '<div class="field"><label for="k-nom">Nominal (Rp)</label><input id="k-nom" type="number" min="1" step="1" inputmode="numeric"></div></div>' +
    '<div class="row"><button type="submit" class="btn primary">Simpan</button><button type="button" class="btn" data-act="kas-batal">Batal</button></div></form>';
  var bulan = {};
  state.kas.forEach(function (t) { if (t.status && t.status !== 'sah') return; var k = t.tgl.slice(0, 7); bulan[k] = bulan[k] || { m: 0, k: 0 }; if (t.jenis === 'masuk') bulan[k].m += t.nominal; else bulan[k].k += t.nominal; });
  var jalan = 0;
  var lap = Object.keys(bulan).sort().map(function (k) { jalan += bulan[k].m - bulan[k].k; return { k: k, m: bulan[k].m, kl: bulan[k].k, saldo: jalan }; }).reverse();
  return '<div class="head"><div><h1>Kas</h1><p class="muted">Pemasukan dan pengeluaran organisasi</p></div>' +
      (bend ? '<button type="button" class="btn primary" data-act="kas-tambah">Catat transaksi</button>' : '') + '</div>' +
    (bend ? '' : '<div class="note">' + (ketua ? 'Sebagai Ketua, Anda memvalidasi pengeluaran mulai ' + rp(BATAS) + '. Pencatatan dilakukan bendahara.' : 'Hanya bendahara yang bisa mencatat transaksi kas.') + '</div>') +
    (bend && state.kasForm ? form : '') +
    '<section class="kpis" aria-label="Ringkasan kas">' +
      '<div class="glass kpi hot"><div class="small muted">Saldo kas</div><div class="v num">' + rp(s.saldo) + '</div></div>' +
      '<div class="glass kpi"><div class="small muted">Total pemasukan</div><div class="v num">' + rp(s.masuk) + '</div></div>' +
      '<div class="glass kpi"><div class="small muted">Total pengeluaran</div><div class="v num">' + rp(s.keluar) + '</div></div>' +
    '</section>' +
    '<section class="glass"><div class="pad"><h2>Riwayat transaksi</h2></div><div class="tablewrap"><table><thead><tr><th>Tanggal</th><th>Jenis</th><th>Kategori</th><th>Keterangan</th><th class="r">Nominal</th><th>Status</th><th>Dicatat oleh</th>' + (ketua ? '<th>Aksi</th>' : '') + '</tr></thead><tbody>' +
      rows.map(function (t) {
        var m = t.jenis === 'masuk', st = ST_KAS[t.status || 'sah'], i = t.id;
        return '<tr><td>' + tgl(t.tgl) + '</td><td>' + pill(m ? 'ok' : 'bad', m ? 'Masuk' : 'Keluar') + '</td><td>' + esc(t.kat) + '</td><td>' + esc(t.ket) + '</td><td class="r num"><span class="' + (m ? 'plus' : 'minus') + '">' + (m ? '+ ' : '− ') + rp(t.nominal) + '</span></td><td>' + pill(st[0], st[1]) + '</td><td>' + esc(t.oleh) + '</td>' +
          (ketua ? '<td>' + (t.status === 'menunggu' ? '<button type="button" class="linkbtn" data-act="kasv-setuju" data-id="' + i + '">Setujui</button> <button type="button" class="linkbtn" data-act="kasv-tolak" data-id="' + i + '">Tolak</button>' : '<span class="muted">Tidak ada</span>') + '</td>' : '') + '</tr>';
      }).join('') +
    '</tbody></table></div></section>' +
    '<section class="glass"><div class="pad"><h2>Laporan keuangan bulanan</h2><p class="small muted">Hanya transaksi yang sudah sah</p></div><div class="tablewrap"><table><thead><tr><th>Bulan</th><th class="r">Pemasukan</th><th class="r">Pengeluaran</th><th class="r">Saldo akhir</th></tr></thead><tbody>' +
      lap.map(function (b) { return '<tr><td>' + new Date(b.k + '-01T00:00:00').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) + '</td><td class="r num">' + rp(b.m) + '</td><td class="r num">' + rp(b.kl) + '</td><td class="r num"><span class="nm">' + rp(b.saldo) + '</span></td></tr>'; }).join('') +
    '</tbody></table></div></section>';
}

// ---------- Log aktivitas ----------
function vLog() {
  return '<div class="head"><div><h1>Log Aktivitas</h1><p class="muted">Siapa mengubah apa, dan kapan</p></div></div>' +
    '<section class="glass">' + (state.log.length ? '<div class="tablewrap"><table><thead><tr><th>Waktu</th><th>Pengguna</th><th>Aktivitas</th></tr></thead><tbody>' +
      state.log.map(function (l) { return '<tr><td class="num">' + wkt(l.waktu) + '</td><td>' + esc(l.oleh) + '</td><td>' + esc(l.teks) + '</td></tr>'; }).join('') +
      '</tbody></table></div>' : '<div class="empty">Belum ada aktivitas.</div>') + '</section>';
}

// ---------- Tampilan anggota ----------
function vSaya() {
  var a = byNik(state.user.nik), s = kasSum();
  var jam = new Date().getHours();
  var salam = (jam < 11 ? 'Selamat pagi' : jam < 15 ? 'Selamat siang' : jam < 18 ? 'Selamat sore' : 'Selamat malam') + ', ' + esc(a.nama.split(' ')[0]);
  var d = a.kar === 'pkwt' && a.akhir ? sisa(a.akhir) : null;
  var riwayat = state.iuranSaya.map(function (r) {
    var ada = r.nominal != null;
    return '<tr><td>' + esc(namaBulan(r.tahun, r.bulan)) + '</td><td class="r num">' + (ada ? '<span class="nm">' + rp(r.nominal) + '</span>' : '<span class="muted">Tidak ada</span>') + '</td><td>' + (ada ? pill('ok', 'Terpotong') : pill('bad', 'Tidak terpotong')) + '</td></tr>';
  }).join('');
  return '<div class="head"><div><h1>' + salam + '</h1><p class="muted">' + today.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + '</p></div></div>' +
    '<section class="glass hero"><div class="hero-t"><span class="chip">KTA digital · ' + unsur(a) + '</span><h2>' + esc(a.nama) + '</h2><p class="num">No. ' + esc(a.kta) + ' · NIK ' + esc(a.nik) + ' · anggota sejak ' + tgl(a.gabung) + '</p>' +
      '<div class="hero-s"><div><b>' + esc(a.plant) + '</b><span>plant</span></div><div><b>' + esc(a.dept) + '</b><span>departemen</span></div><div><b>' + (esc(namaKorlap(a)) || 'Tidak ada') + '</b><span>korlap</span></div></div></div></section>' +
    (d != null && d <= 30 ? '<div class="note">' + (d < 0 ? 'Kontrak Anda sudah lewat ' + (-d) + ' hari.' : 'Kontrak Anda berakhir dalam ' + d + ' hari.') + ' Hubungi korlap atau pengurus bila belum ada kabar perpanjangan.</div>' : '') +
    (state.umum.length ? (function (u) { return '<section class="glass pad stack"><div class="head"><div><h2>' + esc(u.judul) + '</h2><p class="small muted">Pengumuman terbaru · ' + tgl(u.tgl) + '</p></div><a href="#pengumuman" class="small">Lihat semua</a></div><p class="isi">' + esc(u.isi) + '</p></section>'; })(umumUrut()[0]) : '') +
    '<section class="glass pad" style="display:flex;flex-direction:column;gap:16px"><h2>Data kepegawaian</h2><dl class="dl">' +
      '<div><dt>Status karyawan</dt><dd>' + karPill(a) + '</dd></div>' +
      '<div><dt>Akhir kontrak</dt><dd>' + (a.kar === 'pkwt' ? (a.akhir ? tgl(a.akhir) : 'Belum diisi') : 'Tidak ada') + '</dd></div>' +
      '<div><dt>Mulai bekerja</dt><dd>' + tgl(a.mulai) + '</dd></div>' +
      '<div><dt>Keanggotaan</dt><dd>' + angPill(a) + '</dd></div>' +
    '</dl><p class="small muted">Ada data yang keliru? Sampaikan ke korlap atau pengurus untuk diperbaiki.</p></section>' +
    '<section class="glass"><div class="pad"><h2>Riwayat iuran saya</h2><p class="small muted">Hanya Anda dan bendahara yang bisa melihat nominal ini</p></div>' + (riwayat ? '<div class="tablewrap"><table><thead><tr><th>Periode</th><th class="r">Nominal</th><th>Status</th></tr></thead><tbody>' + riwayat + '</tbody></table></div>' : '<div class="empty">Belum ada periode iuran yang dikunci bendahara.</div>') + '</section>' +
    '<section class="kpis" aria-label="Kas organisasi">' +
      '<div class="glass kpi"><div class="small muted">Saldo kas organisasi</div><div class="v num">' + rp(s.saldo) + '</div></div>' +
      '<div class="glass kpi"><div class="small muted">Total pemasukan</div><div class="v num">' + rp(s.masuk) + '</div></div>' +
      '<div class="glass kpi"><div class="small muted">Total pengeluaran</div><div class="v num">' + rp(s.keluar) + '</div></div>' +
    '</section>';
}

// ---------- Pengumuman ----------
// Semua tabel: beri label kolom per sel (untuk tampilan kartu di HP) dan bagi baris per halaman.
function tabelPintar() {
  var view = document.getElementById('view'), rute = location.hash.slice(1) || '';
  view.querySelectorAll('.pager').forEach(function (p) { p.remove(); });
  view.querySelectorAll('table').forEach(function (t, i) {
    var heads = Array.prototype.map.call(t.querySelectorAll('thead th'), function (th) { return th.textContent.trim(); });
    var rows = Array.prototype.slice.call(t.tBodies[0].rows);
    rows.forEach(function (tr) { Array.prototype.forEach.call(tr.cells, function (td, j) { td.setAttribute('data-label', heads[j] || ''); }); });
    var key = rute + ':' + i, n = rows.length, size = state.pageSize, max = Math.max(1, Math.ceil(n / size));
    var pg = Math.min(Math.max(1, state.pages[key] || 1), max); state.pages[key] = pg;
    rows.forEach(function (tr, k) { tr.hidden = k < (pg - 1) * size || k >= pg * size; });
    if (n <= 5) return;
    var el = document.createElement('div'); el.className = 'pager';
    el.innerHTML = '<span class="small muted num">' + ((pg - 1) * size + 1) + ' sampai ' + Math.min(pg * size, n) + ' dari ' + n + '</span>' +
      '<div class="row"><label class="small muted" for="ps-' + i + '">Baris per halaman</label><select id="ps-' + i + '" data-ps="1">' + [5, 10, 25].map(function (s) { return '<option' + (s === size ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></div>' +
      '<div class="row"><button type="button" class="btn" data-act="pg" data-key="' + key + '" data-d="-1"' + (pg <= 1 ? ' disabled' : '') + '>Sebelumnya</button><span class="nm num">' + pg + ' / ' + max + '</span><button type="button" class="btn" data-act="pg" data-key="' + key + '" data-d="1"' + (pg >= max ? ' disabled' : '') + '>Berikutnya</button></div>';
    (t.closest('.tablewrap') || t).insertAdjacentElement('afterend', el);
  });
}
try { state.mini = localStorage.getItem('puk-mini') === '1'; } catch (e) { state.mini = false; }
function terapMini() {
  document.querySelector('.app').classList.toggle('mini', !!state.mini);
  var f = document.getElementById('fold');
  f.setAttribute('aria-expanded', state.mini ? 'false' : 'true');
  f.setAttribute('aria-label', state.mini ? 'Buka menu' : 'Lipat menu');
}
function umumUrut() { return state.umum.slice().sort(function (a, b) { return a.tgl === b.tgl ? b.id - a.id : (a.tgl < b.tgl ? 1 : -1); }); }
function vPengumuman() {
  var bisa = izin('umumBuat'), list = umumUrut();
  var form = '<form id="frmumum" class="glass pad stack" novalidate><h2>Buat pengumuman</h2><div id="umum-err" class="err" role="alert" hidden></div>' +
    '<div class="field"><label for="u-judul">Judul</label><input id="u-judul"></div>' +
    '<div class="field"><label for="u-isi">Isi</label><textarea id="u-isi"></textarea></div>' +
    '<div class="row"><button type="submit" class="btn primary">Terbitkan</button><button type="button" class="btn" data-act="umum-batal">Batal</button></div></form>';
  return '<div class="head"><div><h1>Pengumuman</h1><p class="muted">Informasi dari pengurus untuk semua anggota</p></div>' +
      (bisa ? '<button type="button" class="btn primary" data-act="umum-tambah">Buat pengumuman</button>' : '') + '</div>' +
    (bisa && state.umumForm ? form : '') +
    (list.length ? list.map(function (u) {
      return '<section class="glass pad stack"><div><h2>' + esc(u.judul) + '</h2><p class="small muted">' + tgl(u.tgl) + ' oleh ' + esc(u.oleh) + '</p></div><p class="isi">' + esc(u.isi) + '</p>' +
        (bisa ? (state.hapusUmum === u.id
          ? '<div class="row"><span class="nm">Hapus pengumuman ini?</span><button type="button" class="btn primary" data-act="umum-hapus-ya" data-id="' + u.id + '">Ya, hapus</button><button type="button" class="btn" data-act="umum-hapus-batal">Batal</button></div>'
          : '<div><button type="button" class="linkbtn" data-act="umum-hapus" data-id="' + u.id + '">Hapus</button></div>') : '') + '</section>';
    }).join('') : '<section class="glass"><div class="empty">Belum ada pengumuman.</div></section>');
}

// ---------- Surat keluar ----------
var ROMAWI = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
var KODE_SURAT = { SK: 'Surat keluar', UND: 'Undangan', MDT: 'Mandat', ST: 'Surat tugas' };
var ST_SURAT = { menunggu: ['warn', 'Menunggu tanda tangan'], ttd: ['ok', 'Ditandatangani'], dikembalikan: ['bad', 'Dikembalikan'] };
function suratById(id) { return state.surat.find(function (x) { return x.id === id; }); }
function vSurat() {
  var buat = izin('suratBuat'), ttd = izin('suratTtd');
  var rows = state.surat.slice().sort(function (a, b) { return b.id - a.id; });
  var form = '<form id="frmsurat" class="glass pad stack" novalidate><h2>Buat surat keluar</h2><p class="small muted">Nomor surat dibuat otomatis, lalu surat menunggu tanda tangan Ketua.</p><div id="surat-err" class="err" role="alert" hidden></div>' +
    '<div class="row" style="align-items:flex-end"><div class="field"><label for="sr-kode">Jenis</label><select id="sr-kode">' + ['SK', 'UND', 'MDT'].map(function (k) { return opt(k, KODE_SURAT[k], 'SK'); }).join('') + '</select></div>' +
    '<div class="field grow"><label for="sr-perihal">Perihal</label><input id="sr-perihal"></div>' +
    '<div class="field grow"><label for="sr-tujuan">Tujuan</label><input id="sr-tujuan" placeholder="Misalnya Manajemen HR, PC FSPMI"></div></div>' +
    '<div class="row"><button type="submit" class="btn primary">Simpan dan ajukan</button><button type="button" class="btn" data-act="surat-batal">Batal</button></div></form>';
  return '<div class="head"><div><h1>Surat Keluar</h1><p class="muted">Agenda dan arsip surat keluar organisasi</p></div>' +
      (buat ? '<button type="button" class="btn primary" data-act="surat-tambah">Buat surat</button>' : '') + '</div>' +
    (buat && state.suratForm ? form : '') +
    '<section class="glass"><div class="tablewrap"><table><thead><tr><th>Nomor surat</th><th>Perihal</th><th>Tujuan</th><th>Tanggal</th><th>Status</th><th>Dibuat oleh</th>' + (ttd ? '<th>Aksi</th>' : '') + '</tr></thead><tbody>' +
      rows.map(function (s) {
        var st = ST_SURAT[s.status];
        return '<tr><td><div class="nm num">' + esc(s.no) + '</div><div class="small muted">' + KODE_SURAT[s.kode] + '</div></td><td>' + esc(s.perihal) + '</td><td>' + esc(s.tujuan) + '</td><td>' + tgl(s.tgl) + '</td><td>' + pill(st[0], st[1]) + '</td><td>' + esc(s.oleh) + '</td>' +
          (ttd ? '<td>' + (s.status === 'menunggu' ? '<button type="button" class="linkbtn" data-act="surat-ttd" data-id="' + s.id + '">Tanda tangani</button> <button type="button" class="linkbtn" data-act="surat-kembali" data-id="' + s.id + '">Kembalikan</button>' : '<span class="muted">Tidak ada</span>') + '</td>' : '') + '</tr>';
      }).join('') + '</tbody></table></div></section>';
}

// ---------- Pengaduan dan advokasi ----------
var KAT_ADU = ['Upah', 'Lembur', 'Kontrak', 'K3', 'PHK', 'Lainnya'];
var ST_ADU = { baru: ['warn', 'Baru'], ditolak: ['neu', 'Ditolak'], menunggu_ketua: ['vio', 'Menunggu Ketua'], revisi: ['bad', 'Perlu revisi'], ditangani: ['info', 'Ditangani'], selesai: ['ok', 'Selesai'] };
function vPengaduan() {
  var anggota = state.role === 'anggota', hukum = izin('kasusProses'), ketua = izin('kasusAcc');
  var list = state.aduan.filter(function (d) { return !anggota || d.nik === state.user.nik; }).sort(function (a, b) { return a.tgl === b.tgl ? b.id - a.id : (a.tgl < b.tgl ? 1 : -1); });
  var form = '<form id="frmadu" class="glass pad stack" novalidate><h2>Kirim pengaduan</h2><p class="small muted">Pengaduan hanya bisa dibaca oleh Anda, Bidang Hukum dan Advokasi, Ketua, dan Sekretaris.</p><div id="adu-err" class="err" role="alert" hidden></div>' +
    '<div class="row" style="align-items:flex-end"><div class="field"><label for="d-kat">Kategori</label><select id="d-kat">' + KAT_ADU.map(function (k) { return opt(k, k, ''); }).join('') + '</select></div>' +
    '<div class="field grow"><label for="d-judul">Judul singkat</label><input id="d-judul"></div></div>' +
    '<div class="field"><label for="d-isi">Ceritakan masalahnya</label><textarea id="d-isi"></textarea></div>' +
    '<div><button type="submit" class="btn primary">Kirim pengaduan</button></div></form>';
  return '<div class="head"><div><h1>' + (anggota ? 'Pengaduan' : 'Advokasi') + '</h1><p class="muted">' + (anggota ? 'Sampaikan masalah kerja Anda ke pengurus' : 'Alur: anggota mengadu, Bidang Hukum memverifikasi, Ketua menyetujui surat tugas') + '</p></div></div>' +
    (anggota ? form : '') +
    (list.length ? list.map(function (d) {
      var p = byNik(d.nik), st = ST_ADU[d.status], s = d.suratId ? suratById(d.suratId) : null, id = d.id, aksi = '';
      if (hukum && (d.status === 'baru' || d.status === 'revisi')) {
        aksi = '<div id="e-' + id + '" class="err" role="alert" hidden></div>' +
          '<div class="field"><label for="st-' + id + '">Analisis dan strategi</label><textarea id="st-' + id + '">' + esc(d.strategi || '') + '</textarea></div>' +
          '<div class="field"><label for="t-' + id + '">Tanggapan untuk anggota (alasan bila ditolak)</label><input id="t-' + id + '" value="' + esc(d.tanggapan) + '"></div>' +
          '<div class="row"><button type="button" class="btn primary" data-act="adu-valid" data-id="' + id + '">Valid, ajukan ke Ketua</button><button type="button" class="btn" data-act="adu-tolak" data-id="' + id + '">Tolak kasus</button></div>';
      } else if (hukum && d.status === 'ditangani') {
        aksi = '<div class="row" style="align-items:flex-end"><div class="field grow"><label for="t-' + id + '">Tanggapan untuk anggota</label><input id="t-' + id + '" value="' + esc(d.tanggapan) + '"></div><button type="button" class="btn primary" data-act="adu-selesai" data-id="' + id + '">Tandai selesai</button></div>';
      } else if (ketua && d.status === 'menunggu_ketua') {
        aksi = '<div id="e-' + id + '" class="err" role="alert" hidden></div>' +
          '<div class="field"><label for="ck-' + id + '">Catatan untuk Bidang Hukum (wajib bila minta revisi)</label><input id="ck-' + id + '"></div>' +
          '<div class="row"><button type="button" class="btn primary" data-act="adu-acc" data-id="' + id + '">Setujui dan tanda tangani</button><button type="button" class="btn" data-act="adu-revisi" data-id="' + id + '">Minta revisi</button></div>';
      }
      return '<section class="glass pad stack"><div class="head"><div><h2>' + esc(d.judul) + '</h2><p class="small muted">' + tgl(d.tgl) + (anggota ? '' : ' · ' + esc(p ? p.nama : d.nik) + ' (' + esc(d.nik) + ')') + '</p></div><div class="row">' + pill('neu', d.kat) + pill(st[0], st[1]) + '</div></div>' +
        '<p class="isi">' + esc(d.isi) + '</p>' +
        (!anggota && d.strategi && !(hukum && (d.status === 'baru' || d.status === 'revisi')) ? '<div><div class="small muted nm">Analisis dan strategi</div><p class="isi">' + esc(d.strategi) + '</p></div>' : '') +
        (s && (!anggota || s.status === 'ttd') ? '<p class="small"><span class="nm num">Surat tugas ' + esc(s.no) + '</span> ' + pill(ST_SURAT[s.status][0], ST_SURAT[s.status][1]) + '</p>' : '') +
        (!anggota && d.status === 'revisi' && d.catatanKetua ? '<div class="note"><span class="nm">Catatan Ketua:</span> ' + esc(d.catatanKetua) + '</div>' : '') +
        (anggota || !aksi ? (d.tanggapan ? '<div class="note"><span class="nm">Tanggapan pengurus:</span> ' + esc(d.tanggapan) + '</div>' : '<p class="small muted">Belum ada tanggapan dari pengurus.</p>') : '') +
        aksi + '</section>';
    }).join('') : '<section class="glass"><div class="empty">' + (anggota ? 'Anda belum pernah mengirim pengaduan.' : 'Belum ada pengaduan.') + '</div></section>');
}

// ---------- Modul bidang, surat masuk, donasi, KTA ----------
var ST_PKB = { draf: ['neu', 'Draf'], diusulkan: ['warn', 'Diusulkan ke manajemen'], dirundingkan: ['info', 'Dirundingkan'], disepakati: ['ok', 'Disepakati'] };
var JENIS_SOS = ['Sakit', 'Duka', 'Kelahiran', 'Musibah'];
var ST_SOS = { baru: ['warn', 'Baru'], disetujui: ['ok', 'Disetujui'], ditolak: ['neu', 'Ditolak'] };
var ST_SM = { baru: ['warn', 'Belum didisposisi'], didisposisi: ['info', 'Didisposisi'], selesai: ['ok', 'Selesai'] };
function fld(id, label, ctl, grow) { return '<div class="field' + (grow ? ' grow' : '') + '"><label for="' + id + '">' + label + '</label>' + ctl + '</div>'; }
function tombolForm(teks) { return '<div class="row"><button type="submit" class="btn primary">' + (teks || 'Simpan') + '</button><button type="button" class="btn" data-act="bd-tutup">Batal</button></div>'; }
function tombolBuka(f, teks) { return '<button type="button" class="btn primary" data-act="bd-buka" data-f="' + f + '">' + teks + '</button>'; }
function nama(nik) { var a = byNik(nik); return a ? a.nama : nik; }

function vPendidikan() {
  var kelola = izin('diklatKelola');
  var form = '<form id="frmdiklat" class="glass pad stack" novalidate><h2>Jadwalkan pelatihan</h2><div id="diklat-err" class="err" role="alert" hidden></div><div class="row" style="align-items:flex-end">' +
    fld('dk-judul', 'Judul pelatihan', '<input id="dk-judul">', true) + fld('dk-tgl', 'Tanggal', '<input id="dk-tgl" type="date" value="' + plus(14) + '">') +
    fld('dk-tempat', 'Tempat', '<input id="dk-tempat">') + fld('dk-kuota', 'Kuota peserta', '<input id="dk-kuota" type="number" min="1" value="20">') + '</div>' + tombolForm() + '</form>';
  var list = state.diklat.slice().sort(function (a, b) { return a.tgl < b.tgl ? -1 : 1; });
  return '<div class="head"><div><h1>Pendidikan</h1><p class="muted">Program pendidikan dan pelatihan anggota</p></div>' + (kelola ? tombolBuka('diklat', 'Jadwalkan pelatihan') : '') + '</div>' +
    (kelola && state.bidangForm === 'diklat' ? form : '') +
    list.map(function (d) {
      var ikut = d.peserta.indexOf(state.user.nik) >= 0, penuh = d.jumlah >= d.kuota;
      return '<section class="glass pad stack"><div class="head"><div><h2>' + esc(d.judul) + '</h2><p class="small muted">' + tgl(d.tgl) + ' · ' + esc(d.tempat) + '</p></div>' + pill(penuh ? 'neu' : 'ok', d.jumlah + ' dari ' + d.kuota + ' peserta') + '</div>' +
        '<div class="bar"><i style="width:' + Math.min(100, Math.round(d.jumlah / d.kuota * 100)) + '%"></i></div>' +
        (kelola ? '<p class="small"><span class="nm">Peserta:</span> ' + (d.peserta.map(function (n) { return esc(nama(n)); }).join(', ') || 'Belum ada') + '</p>' : '') +
        '<div><button type="button" class="btn' + (ikut ? '' : ' primary') + '" data-act="bd-ikut" data-id="' + d.id + '"' + (!ikut && penuh ? ' disabled' : '') + '>' + (ikut ? 'Batalkan pendaftaran saya' : (penuh ? 'Kuota penuh' : 'Daftar ikut')) + '</button></div></section>';
    }).join('');
}

function vPkb() {
  var kelola = izin('pkbKelola');
  var form = '<form id="frmpkb" class="glass pad stack" novalidate><h2>Tambah usulan pasal</h2><div id="pkb-err" class="err" role="alert" hidden></div>' +
    fld('pk-pasal', 'Pasal atau topik', '<input id="pk-pasal">') + fld('pk-usulan', 'Isi usulan', '<textarea id="pk-usulan"></textarea>') + tombolForm() + '</form>';
  return '<div class="head"><div><h1>Pengupahan &amp; PKB</h1><p class="muted">Usulan pembaruan pasal PKB dan perkembangan perundingannya</p></div>' + (kelola ? tombolBuka('pkb', 'Tambah usulan') : '') + '</div>' +
    (kelola && state.bidangForm === 'pkb' ? form : '') +
    state.pkb.map(function (u) {
      var st = ST_PKB[u.status];
      return '<section class="glass pad stack"><div class="head"><h2>' + esc(u.pasal) + '</h2>' + pill(st[0], st[1]) + '</div><p class="isi">' + esc(u.usulan) + '</p>' +
        (kelola ? '<div class="field" style="max-width:280px"><label for="pkb-' + u.id + '">Ubah status</label><select id="pkb-' + u.id + '" data-pkb="' + u.id + '">' + Object.keys(ST_PKB).map(function (k) { return opt(k, ST_PKB[k][1], u.status); }).join('') + '</select></div>' : '') + '</section>';
    }).join('');
}

function vSosial() {
  var kelola = izin('sosialKelola'), pengurus = state.role !== 'anggota';
  var list = state.sosial.filter(function (x) { return pengurus || x.nik === state.user.nik; }).sort(function (a, b) { return b.id - a.id; });
  var form = '<form id="frmsos" class="glass pad stack" novalidate><h2>Ajukan santunan</h2><div id="sos-err" class="err" role="alert" hidden></div><div class="row" style="align-items:flex-end">' +
    fld('so-jenis', 'Jenis', '<select id="so-jenis">' + JENIS_SOS.map(function (j) { return opt(j, j, ''); }).join('') + '</select>') + fld('so-ket', 'Keterangan singkat', '<input id="so-ket">', true) + '</div>' + tombolForm('Kirim pengajuan') + '</form>';
  return '<div class="head"><div><h1>Kesejahteraan Sosial</h1><p class="muted">Dana sosial dan santunan anggota</p></div>' + tombolBuka('sos', 'Ajukan santunan') + '</div>' +
    (state.bidangForm === 'sos' ? form : '') +
    (list.length ? list.map(function (x) {
      var st = ST_SOS[x.status];
      return '<section class="glass pad stack"><div class="head"><div><h2>Santunan ' + esc(x.jenis.toLowerCase()) + '</h2><p class="small muted">' + tgl(x.tgl) + ' · ' + esc(nama(x.nik)) + '</p></div>' + pill(st[0], st[1]) + '</div><p class="isi">' + esc(x.ket) + '</p>' +
        (x.status === 'disetujui' ? '<p><span class="nm num">' + rp(x.nominal) + '</span> <span class="small muted">dicatat sebagai pengeluaran kas</span></p>' : '') +
        (x.catatan ? '<div class="note"><span class="nm">Catatan bidang:</span> ' + esc(x.catatan) + '</div>' : '') +
        (kelola && x.status === 'baru' ? '<div id="se-' + x.id + '" class="err" role="alert" hidden></div><div class="row" style="align-items:flex-end">' + fld('sn-' + x.id, 'Nominal santunan (Rp)', '<input id="sn-' + x.id + '" type="number" min="1" inputmode="numeric">') + fld('sc-' + x.id, 'Catatan (alasan bila ditolak)', '<input id="sc-' + x.id + '">', true) + '</div>' +
          '<div class="row"><button type="button" class="btn primary" data-act="bd-sos-setuju" data-id="' + x.id + '">Setujui</button><button type="button" class="btn" data-act="bd-sos-tolak" data-id="' + x.id + '">Tolak</button></div>' : '') + '</section>';
    }).join('') : '<section class="glass"><div class="empty">Belum ada pengajuan santunan.</div></section>');
}

function vDonasi() {
  var verif = izin('donasiVerif'), buat = izin('kampanye');
  var list = state.donasi.filter(function (d) { return verif || d.nik === state.user.nik; }).sort(function (a, b) { return b.id - a.id; });
  var fKamp = '<form id="frmkamp" class="glass pad stack" novalidate><h2>Buka penggalangan donasi</h2><div id="kamp-err" class="err" role="alert" hidden></div><div class="row" style="align-items:flex-end">' +
    fld('km-judul', 'Judul penggalangan', '<input id="km-judul">', true) + fld('km-target', 'Target (Rp)', '<input id="km-target" type="number" min="1" inputmode="numeric">') + '</div>' + tombolForm() + '</form>';
  var fDon = '<form id="frmdon" class="glass pad stack" novalidate><h2>Catat donasi saya</h2><p class="small muted">Serahkan atau transfer donasi ke bendahara. Donasi baru dihitung setelah bendahara memverifikasinya.</p><div id="don-err" class="err" role="alert" hidden></div><div class="row" style="align-items:flex-end">' +
    fld('dn-kamp', 'Penggalangan', '<select id="dn-kamp">' + state.kampanye.map(function (k) { return opt(String(k.id), k.judul, ''); }).join('') + '</select>', true) + fld('dn-nom', 'Nominal (Rp)', '<input id="dn-nom" type="number" min="1" inputmode="numeric">') + '</div>' + tombolForm('Kirim') + '</form>';
  return '<div class="head"><div><h1>Donasi</h1><p class="muted">Penggalangan dana solidaritas</p></div><div class="row">' + (buat ? '<button type="button" class="btn" data-act="bd-buka" data-f="kamp">Buka penggalangan</button>' : '') + tombolBuka('don', 'Donasi') + '</div></div>' +
    (buat && state.bidangForm === 'kamp' ? fKamp : '') + (state.bidangForm === 'don' ? fDon : '') +
    state.kampanye.map(function (k) {
      var n = terkumpul(k.id);
      return '<section class="glass pad stack"><div class="head"><h2>' + esc(k.judul) + '</h2>' + pill('info', Math.round(n / k.target * 100) + '% dari target') + '</div><div class="bar"><i style="width:' + Math.min(100, Math.round(n / k.target * 100)) + '%"></i></div><p><span class="nm num">' + rp(n) + '</span> <span class="small muted">terkumpul dari target ' + rp(k.target) + '</span></p></section>';
    }).join('') +
    '<section class="glass"><div class="pad"><h2>' + (verif ? 'Semua donasi' : 'Riwayat donasi saya') + '</h2></div>' + (list.length ? '<div class="tablewrap"><table><thead><tr><th>Tanggal</th>' + (verif ? '<th>Donatur</th>' : '') + '<th>Penggalangan</th><th class="r">Nominal</th><th>Status</th>' + (verif ? '<th>Aksi</th>' : '') + '</tr></thead><tbody>' +
      list.map(function (d) {
        var k = state.kampanye.find(function (x) { return x.id === d.kampanye; }), sah = d.status === 'sah';
        return '<tr><td>' + tgl(d.tgl) + '</td>' + (verif ? '<td>' + esc(nama(d.nik)) + '</td>' : '') + '<td>' + esc(k ? k.judul : '') + '</td><td class="r num"><span class="nm">' + rp(d.nominal) + '</span></td><td>' + pill(sah ? 'ok' : 'warn', sah ? 'Terverifikasi' : 'Menunggu verifikasi') + '</td>' +
          (verif ? '<td>' + (sah ? '<span class="muted">Tidak ada</span>' : '<button type="button" class="linkbtn" data-act="bd-don-verif" data-id="' + d.id + '">Verifikasi</button>') + '</td>' : '') + '</tr>';
      }).join('') + '</tbody></table></div>' : '<div class="empty">Belum ada donasi.</div>') + '</section>';
}

function vSuratMasuk() {
  var catatS = izin('suratMasukCatat'), disp = izin('disposisi');
  var form = '<form id="frmsm" class="glass pad stack" novalidate><h2>Catat surat masuk</h2><div id="sm-err" class="err" role="alert" hidden></div><div class="row" style="align-items:flex-end">' +
    fld('sm-no', 'Nomor surat', '<input id="sm-no">') + fld('sm-pengirim', 'Pengirim', '<input id="sm-pengirim">') + fld('sm-perihal', 'Perihal', '<input id="sm-perihal">', true) + fld('sm-tgl', 'Tanggal diterima', '<input id="sm-tgl" type="date" value="' + iso(today) + '">') + '</div>' + tombolForm() + '</form>';
  var tujuan = Object.keys(LABEL).filter(function (k) { return k !== 'anggota' && k !== 'ketua'; });
  var rows = state.suratMasuk.slice().sort(function (a, b) { return b.id - a.id; });
  return '<div class="head"><div><h1>Surat Masuk</h1><p class="muted">Agenda surat masuk dan disposisi Ketua</p></div>' + (catatS ? tombolBuka('sm', 'Catat surat masuk') : '') + '</div>' +
    (catatS && state.bidangForm === 'sm' ? form : '') +
    '<section class="glass"><div class="tablewrap"><table><thead><tr><th>Nomor surat</th><th>Pengirim</th><th>Perihal</th><th>Diterima</th><th>Disposisi</th><th>Status</th><th>Aksi</th></tr></thead><tbody>' +
      rows.map(function (s) {
        var st = ST_SM[s.status], milik = s.disposisi === state.role || catatS;
        var d = disp && s.status !== 'selesai' ? '<select id="dsp-' + s.id + '" data-disp="' + s.id + '" aria-label="Disposisi surat ' + esc(s.no) + '" style="min-width:200px">' + opt('', 'Pilih tujuan', s.disposisi) + tujuan.map(function (k) { return opt(k, LABEL[k], s.disposisi); }).join('') + '</select>' : (s.disposisi ? esc(LABEL[s.disposisi]) : '<span class="muted">Belum ada</span>');
        return '<tr><td><div class="nm num">' + esc(s.no) + '</div></td><td>' + esc(s.pengirim) + '</td><td>' + esc(s.perihal) + '</td><td>' + tgl(s.tgl) + '</td><td>' + d + '</td><td>' + pill(st[0], st[1]) + '</td><td>' + (s.status === 'didisposisi' && milik ? '<button type="button" class="linkbtn" data-act="bd-sm-selesai" data-id="' + s.id + '">Tandai selesai</button>' : '<span class="muted">Tidak ada</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div></section>';
}

function nikKta() { return state.role === 'anggota' ? state.user.nik : (state.ktaNik || state.user.nik); }
function vKta() {
  var a = byNik(nikKta());
  return '<div class="head"><div><h1>KTA Digital</h1><p class="muted">' + esc(a.nama) + ' · ' + esc(a.kta) + '</p></div>' + (state.role === 'anggota' ? '' : '<a class="btn" href="#anggota">Kembali ke Data Anggota</a>') + '</div>' +
    '<section class="glass pad stack"><img id="kta-img" alt="Kartu tanda anggota ' + esc(a.nama) + ', nomor ' + esc(a.kta) + '" style="width:100%;max-width:560px;border-radius:18px;box-shadow:var(--shadow)">' +
    '<div class="row"><a class="btn primary" id="kta-unduh" download="' + esc(a.kta) + '.png">Unduh PNG</a><button type="button" class="btn" data-act="cetak">Cetak</button></div><p class="small muted">Kode QR berisi nomor KTA dan NIK.</p></section>';
}
function gambarKta() {
  var img = document.getElementById('kta-img'); if (!img) return;
  var a = byNik(nikKta()), W = 1012, H = 638, c = document.createElement('canvas'); c.width = W; c.height = H;
  var x = c.getContext('2d');
  function kotak(px, py, w, h, r) { x.beginPath(); if (x.roundRect) x.roundRect(px, py, w, h, r); else x.rect(px, py, w, h); }
  var g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#C2453A'); g.addColorStop(1, '#7E1C15');
  x.fillStyle = g; kotak(0, 0, W, H, 36); x.fill();
  x.save(); kotak(0, 0, W, H, 36); x.clip();
  x.fillStyle = 'rgba(255,255,255,0.08)'; x.beginPath(); x.arc(W - 110, 80, 230, 0, 7); x.fill(); x.beginPath(); x.arc(90, H + 60, 260, 0, 7); x.fill();
  x.restore();
  x.fillStyle = '#FFFFFF'; x.textBaseline = 'alphabetic';
  x.font = '700 30px "Space Grotesk", Inter, sans-serif'; x.fillText('KARTU TANDA ANGGOTA', 56, 86);
  x.font = '500 24px Inter, sans-serif'; x.fillText('PUK SPAMK FSPMI · PT. SANLY INDUSTRIES', 56, 122);
  var fs = 56; do { x.font = '700 ' + fs + 'px "Space Grotesk", Inter, sans-serif'; fs -= 2; } while (x.measureText(a.nama).width > 590 && fs > 28);
  x.fillText(a.nama, 56, 290);
  x.font = '600 30px Inter, sans-serif'; x.fillText(a.kta, 56, 338);
  var pasangan = [['NIK', a.nik, 56, 430], ['Unsur', unsur(a), 330, 430], ['Plant dan departemen', a.plant + ' · ' + a.dept, 56, 530], ['Anggota sejak', tgl(a.gabung), 420, 530]];
  pasangan.forEach(function (p) { x.font = '500 20px Inter, sans-serif'; x.fillText(p[0], p[2], p[3]); x.font = '600 26px Inter, sans-serif'; x.fillText(p[1], p[2], p[3] + 34); });
  var S = 250, qx = W - 56 - S, qy = H - 56 - S;
  x.fillStyle = '#FFFFFF'; kotak(qx, qy, S, S, 20); x.fill();
  try {
    if (typeof qrcode === 'function') {
      var q = qrcode(0, 'M'); q.addData(a.kta + '|' + a.nik); q.make();
      var n = q.getModuleCount(), m = (S - 36) / n; x.fillStyle = '#1B1F27';
      for (var r = 0; r < n; r++) for (var k = 0; k < n; k++) if (q.isDark(r, k)) x.fillRect(qx + 18 + k * m, qy + 18 + r * m, Math.ceil(m), Math.ceil(m));
    } else { x.fillStyle = '#8E1F16'; x.font = '600 22px Inter, sans-serif'; x.textAlign = 'center'; x.fillText(a.kta, qx + S / 2, qy + S / 2 + 8); x.textAlign = 'left'; }
  } catch (e) {}
  try { var url = c.toDataURL('image/png'); img.src = url; var dl = document.getElementById('kta-unduh'); if (dl) dl.href = url; } catch (e) {}
}

// ---------- Perangkat pendukung: Korlap dan Garda Metal ----------
var JENIS_TUGAS = ['Pengamanan rapat', 'Pengawalan advokasi', 'Aksi massa', 'Kegiatan organisasi'];
function daftarKorlap() { return state.anggota.filter(function (a) { return a.status === 'aktif' && unsur(a) === 'Korlap'; }); }
function binaan(nik) { return state.anggota.filter(function (a) { return a.korlap === nik && a.status === 'aktif'; }); }
function menuPerangkat() {
  var me = byNik(state.user.nik), p = state.role !== 'anggota', kor = unsur(me) === 'Korlap', out = [];
  var n = izin('korlapKelola') ? state.aspirasi.filter(function (x) { return x.status === 'baru'; }).length : (kor ? state.instruksi.filter(function (x) { return x.sampai.indexOf(me.nik) < 0; }).length : 0);
  if (p || kor) out.push(['korlap', 'Korlap', 'jaring', 'Perangkat', n]);
  if (p || me.garda) out.push(['garda', 'Garda Metal', 'perisai', 'Perangkat', me.garda ? state.tugasGarda.filter(function (t) { return t.personel.length < t.butuh && t.personel.indexOf(me.nik) < 0; }).length : 0]);
  return out;
}

function vKorlap() {
  var me = byNik(state.user.nik), kor = unsur(me) === 'Korlap', kelola = izin('korlapKelola'), pengurus = state.role !== 'anggota';
  var semua = daftarKorlap(), html = '';
  var fIns = '<form id="frmins" class="glass pad stack" novalidate><h2>Kirim instruksi ke korlap</h2><div id="ins-err" class="err" role="alert" hidden></div>' +
    fld('in-judul', 'Judul', '<input id="in-judul">') + fld('in-isi', 'Isi instruksi', '<textarea id="in-isi"></textarea>') + tombolForm('Kirim') + '</form>';
  var fAsp = '<form id="frmasp" class="glass pad stack" novalidate><h2>Sampaikan aspirasi basis</h2><div id="asp-err" class="err" role="alert" hidden></div>' +
    fld('as-isi', 'Aspirasi atau keluhan dari anggota di lini Anda', '<textarea id="as-isi"></textarea>') + tombolForm('Kirim ke pengurus') + '</form>';
  html += '<div class="head"><div><h1>Korlap</h1><p class="muted">Jembatan antara pengurus dan anggota di lini produksi</p></div><div class="row">' +
    (kor ? '<button type="button" class="btn" data-act="bd-buka" data-f="aspirasi">Sampaikan aspirasi</button>' : '') + (kelola ? tombolBuka('instruksi', 'Kirim instruksi') : '') + '</div></div>' +
    (kelola && state.bidangForm === 'instruksi' ? fIns : '') + (kor && state.bidangForm === 'aspirasi' ? fAsp : '');
  if (kor) {
    var b = binaan(me.nik);
    html += '<section class="glass"><div class="pad"><h2>Basis saya</h2><p class="small muted">' + b.length + ' anggota aktif di bawah koordinasi Anda</p></div>' + (b.length ? '<div class="tablewrap"><table><thead><tr><th>Anggota</th><th>Departemen</th><th>Plant</th><th>Status karyawan</th><th>Akhir kontrak</th><th>No. HP</th></tr></thead><tbody>' +
      b.map(function (a) {
        var ak = a.kar === 'pkwt' ? (a.akhir ? tgl(a.akhir) + (sisa(a.akhir) <= 30 ? ' ' + sisaPill(sisa(a.akhir)) : '') : '<span class="muted">Belum diisi</span>') : '<span class="muted">Tidak ada</span>';
        return '<tr><td><div class="nm">' + esc(a.nama) + '</div><div class="small muted num">' + esc(a.nik) + '</div></td><td>' + esc(a.dept) + '</td><td>' + esc(a.plant) + '</td><td>' + karPill(a) + '</td><td>' + ak + '</td><td>' + (esc(a.hp || '') || '<span class="muted">Belum diisi</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="empty">Belum ada anggota yang dikoordinasi.</div>') + '</section>';
  }
  html += '<section class="glass pad stack"><h2>Instruksi organisasi</h2>' + (state.instruksi.length ? state.instruksi.slice().sort(function (a, b) { return b.id - a.id; }).map(function (i) {
    var sudah = i.sampai.indexOf(me.nik) >= 0;
    return '<div class="agenda" style="align-items:flex-start;flex-wrap:wrap"><span class="bar"></span><div style="flex:1 1 240px;min-width:0"><div class="nm">' + esc(i.judul) + '</div><div class="small muted">' + tgl(i.tgl) + ' oleh ' + esc(i.oleh) + '</div><p class="isi" style="margin-top:6px">' + esc(i.isi) + '</p>' +
      (pengurus ? '<p class="small muted" style="margin-top:6px">' + i.sampai.length + ' dari ' + semua.length + ' korlap sudah menyampaikan ke basis</p>' : '') + '</div>' +
      (kor ? (sudah ? pill('ok', 'Sudah disampaikan') : '<button type="button" class="btn primary" data-act="pr-ins-sampai" data-id="' + i.id + '">Tandai sudah disampaikan</button>') : '') + '</div>';
  }).join('') : '<p class="muted">Belum ada instruksi.</p>') + '</section>';
  var asp = state.aspirasi.filter(function (x) { return pengurus || x.nik === me.nik; }).sort(function (a, b) { return b.id - a.id; });
  html += '<section class="glass pad stack"><h2>' + (pengurus ? 'Aspirasi dari basis' : 'Aspirasi yang saya sampaikan') + '</h2>' + (asp.length ? asp.map(function (x) {
    var baru = x.status === 'baru';
    return '<div class="stack" style="border-top:1px solid var(--line);padding-top:12px"><div class="head"><div class="small muted">' + tgl(x.tgl) + ' · ' + esc(nama(x.nik)) + '</div>' + pill(baru ? 'warn' : 'ok', baru ? 'Baru' : 'Ditindaklanjuti') + '</div><p class="isi">' + esc(x.isi) + '</p>' +
      (x.tanggapan ? '<div class="note"><span class="nm">Tanggapan pengurus:</span> ' + esc(x.tanggapan) + '</div>' : '') +
      (kelola && baru ? '<div id="ae-' + x.id + '" class="err" role="alert" hidden></div><div class="row" style="align-items:flex-end">' + fld('at-' + x.id, 'Tanggapan untuk korlap', '<input id="at-' + x.id + '">', true) + '<button type="button" class="btn primary" data-act="pr-asp-tindak" data-id="' + x.id + '">Tindak lanjuti</button></div>' : '') + '</div>';
  }).join('') : '<p class="muted">Belum ada aspirasi.</p>') + '</section>';
  if (pengurus) {
    var tanpa = state.anggota.filter(function (a) { return a.status === 'aktif' && !a.korlap && !a.isKorlap; }).length;
    var calon = state.anggota.filter(function (a) { return a.status === 'aktif' && !a.isKorlap; });
    html += '<section class="glass"><div class="pad head"><div><h2>Struktur korlap</h2><p class="small muted">' + semua.length + ' korlap, ' + tanpa + ' anggota aktif belum punya korlap</p></div>' +
      (kelola ? '<div class="row" style="align-items:flex-end"><div class="field" style="flex:1 1 220px"><label for="kl-baru">Tetapkan korlap baru</label><select id="kl-baru">' + opt('', 'Pilih anggota', '') + calon.map(function (a) { return opt(a.nik, a.nama + ' · ' + a.plant, ''); }).join('') + '</select></div><button type="button" class="btn primary" data-act="pr-kl-tetap">Tetapkan</button></div>' : '') + '</div>' +
      '<div class="tablewrap"><table><thead><tr><th>Korlap</th><th>Plant</th><th>Departemen</th><th class="r">Anggota binaan</th>' + (kelola ? '<th>Aksi</th>' : '') + '</tr></thead><tbody>' +
      semua.map(function (a) {
        var aksi = !kelola ? '' : '<td><button type="button" class="linkbtn" data-act="pr-kl-buka" data-nik="' + esc(a.nik) + '">Kelola basis</button> ' +
          (state.korlapCabut === a.nik ? '<span class="nm">Cabut penetapan?</span> <button type="button" class="linkbtn" data-act="pr-kl-cabut-ya" data-nik="' + esc(a.nik) + '">Ya</button> <button type="button" class="linkbtn" data-act="pr-kl-cabut-batal">Batal</button>'
            : '<button type="button" class="linkbtn" data-act="pr-kl-cabut" data-nik="' + esc(a.nik) + '">Cabut</button>') + '</td>';
        return '<tr><td><div class="nm">' + esc(a.nama) + '</div><div class="small muted num">' + esc(a.nik) + '</div></td><td>' + esc(a.plant) + '</td><td>' + esc(a.dept) + '</td><td class="r num"><span class="nm">' + binaan(a.nik).length + '</span></td>' + aksi + '</tr>';
      }).join('') + '</tbody></table></div></section>';
    var k = kelola && state.korlapBuka ? byNik(state.korlapBuka) : null;
    if (k && k.isKorlap) {
      var bs = binaan(k.nik), bisa = state.anggota.filter(function (a) { return a.status === 'aktif' && a.nik !== k.nik && a.korlap !== k.nik; });
      html += '<section class="glass" id="kl-panel"><div class="pad head"><div><h2>Basis ' + esc(k.nama) + '</h2><p class="small muted">' + bs.length + ' anggota. Menambahkan anggota ke sini melepasnya dari korlap sebelumnya.</p></div><button type="button" class="btn" data-act="pr-kl-tutup">Tutup</button></div>' +
        '<div class="pad row" style="align-items:flex-end;padding-top:0"><div class="field grow"><label for="kl-tambah">Tambah anggota ke basis ini</label><select id="kl-tambah">' + opt('', 'Pilih anggota', '') +
          bisa.map(function (a) { return opt(a.nik, a.nama + ' · ' + a.plant + (a.korlap ? ' (korlap: ' + namaKorlap(a) + ')' : ' (belum punya korlap)'), ''); }).join('') + '</select></div><button type="button" class="btn primary" data-act="pr-kl-tambah">Tambah</button></div>' +
        (bs.length ? '<div class="tablewrap"><table><thead><tr><th>Anggota</th><th>Departemen</th><th>Plant</th><th>Aksi</th></tr></thead><tbody>' +
          bs.map(function (a) { return '<tr><td><div class="nm">' + esc(a.nama) + '</div><div class="small muted num">' + esc(a.nik) + '</div></td><td>' + esc(a.dept) + '</td><td>' + esc(a.plant) + '</td><td><button type="button" class="linkbtn" data-act="pr-kl-lepas" data-nik="' + esc(a.nik) + '">Lepas dari basis</button></td></tr>'; }).join('') + '</tbody></table></div>'
          : '<div class="empty">Belum ada anggota di basis ini.</div>') + '</section>';
    }
  }
  return html;
}

function vGarda() {
  var me = byNik(state.user.nik), kelola = izin('gardaKelola');
  var roster = state.anggota.filter(function (a) { return a.garda && a.status === 'aktif'; });
  var form = '<form id="frmtugas" class="glass pad stack" novalidate><h2>Buat penugasan</h2><div id="tugas-err" class="err" role="alert" hidden></div><div class="row" style="align-items:flex-end">' +
    fld('tg-judul', 'Nama kegiatan', '<input id="tg-judul">', true) + fld('tg-jenis', 'Jenis', '<select id="tg-jenis">' + JENIS_TUGAS.map(function (j) { return opt(j, j, ''); }).join('') + '</select>') +
    fld('tg-tgl', 'Tanggal', '<input id="tg-tgl" type="date" value="' + plus(7) + '">') + fld('tg-lokasi', 'Lokasi', '<input id="tg-lokasi">') + fld('tg-butuh', 'Personel dibutuhkan', '<input id="tg-butuh" type="number" min="1" value="2">') + '</div>' + tombolForm() + '</form>';
  return '<div class="head"><div><h1>Garda Metal</h1><p class="muted">Sayap pengamanan dan pengawalan agenda organisasi</p></div>' + (kelola ? tombolBuka('tugas', 'Buat penugasan') : '') + '</div>' +
    (kelola && state.bidangForm === 'tugas' ? form : '') +
    state.tugasGarda.slice().sort(function (a, b) { return a.tgl < b.tgl ? -1 : 1; }).map(function (t) {
      var siap = t.personel.indexOf(me.nik) >= 0, cukup = t.personel.length >= t.butuh;
      return '<section class="glass pad stack"><div class="head"><div><h2>' + esc(t.judul) + '</h2><p class="small muted">' + tgl(t.tgl) + ' · ' + esc(t.lokasi) + '</p></div><div class="row">' + pill('neu', t.jenis) + pill(cukup ? 'ok' : 'warn', t.personel.length + ' dari ' + t.butuh + ' personel') + '</div></div>' +
        '<div class="bar"><i style="width:' + Math.min(100, Math.round(t.personel.length / t.butuh * 100)) + '%"></i></div>' +
        '<p class="small"><span class="nm">Siap bertugas:</span> ' + (t.personel.map(function (n) { return esc(nama(n)); }).join(', ') || 'Belum ada') + '</p>' +
        (me.garda ? '<div><button type="button" class="btn' + (siap ? '' : ' primary') + '" data-act="pr-siap" data-id="' + t.id + '"' + (!siap && cukup ? ' disabled' : '') + '>' + (siap ? 'Batalkan kesiapan saya' : (cukup ? 'Personel sudah cukup' : 'Saya siap bertugas')) + '</button></div>' : '') + '</section>';
    }).join('') +
    '<section class="glass"><div class="pad"><h2>Anggota Garda Metal</h2><p class="small muted">' + roster.length + ' personel aktif. Keanggotaan Garda Metal diatur lewat Data Anggota.</p></div><div class="tablewrap"><table><thead><tr><th>Anggota</th><th>Plant</th><th>Departemen</th><th>Korlap</th></tr></thead><tbody>' +
      roster.map(function (a) { return '<tr><td><div class="nm">' + esc(a.nama) + '</div><div class="small muted num">' + esc(a.nik) + '</div></td><td>' + esc(a.plant) + '</td><td>' + esc(a.dept) + '</td><td>' + (esc(namaKorlap(a)) || '<span class="muted">Tidak ada</span>') + '</td></tr>'; }).join('') + '</tbody></table></div></section>';
}

// ---------- Pengguna dan hak akses ----------
function vPengguna() {
  var rows = state.anggota.filter(function (a) { return a.status === 'aktif'; });
  return '<div class="head"><div><h1>Pengguna</h1><p class="muted">Atur peran dan hak akses tiap akun</p></div></div>' +
    '<section class="glass"><div class="tablewrap"><table><thead><tr><th>Pengguna</th><th>Unsur</th><th>Peran</th><th>Sandi</th></tr></thead><tbody>' +
      rows.map(function (a) {
        var p = a.peran || 'anggota', diri = a.nik === state.user.nik;
        return '<tr><td><div class="nm">' + esc(a.nama) + '</div><div class="small muted num">' + esc(a.nik) + '</div></td><td>' + unsur(a) + '</td>' +
          '<td><select id="pr-' + esc(a.nik) + '" data-peran="' + esc(a.nik) + '" aria-label="Peran ' + esc(a.nama) + '"' + (diri ? ' disabled' : '') + ' style="min-width:210px">' + Object.keys(LABEL).map(function (k) { return opt(k, LABEL[k], p); }).join('') + '</select></td>' +
          '<td><button type="button" class="linkbtn" data-act="sandi-reset" data-nik="' + esc(a.nik) + '">Reset sandi</button></td></tr>';
      }).join('') + '</tbody></table></div></section>' +
    '<p class="small" style="padding:0 4px">Peran Anda sendiri tidak bisa diubah dari sini, supaya selalu ada satu admin.</p>';
}

// ---------- Daftar tindakan per peran (dashboard) ----------
function hitungAduan(st) { return state.aduan.filter(function (d) { return st.indexOf(d.status) >= 0; }).length; }
function hitungSurat(st) { return state.surat.filter(function (s) { return s.status === st && !s.kasusId; }).length; }
function hitungKas() { return state.kas.filter(function (t) { return t.status === 'menunggu'; }).length; }
function tugasHtml() {
  var t = [], n;
  if (izin('kasusAcc') && (n = hitungAduan(['menunggu_ketua']))) t.push([n + ' kasus advokasi menunggu persetujuan Anda', 'pengaduan']);
  if (izin('suratTtd') && (n = hitungSurat('menunggu'))) t.push([n + ' surat keluar menunggu tanda tangan Anda', 'surat']);
  if (izin('kasValidasi') && (n = hitungKas())) t.push([n + ' pengeluaran kas menunggu validasi Anda', 'kas']);
  if (izin('kasusProses') && (n = hitungAduan(['baru', 'revisi']))) t.push([n + ' pengaduan perlu diverifikasi atau direvisi', 'pengaduan']);
  if (izin('iuranKelola')) { if (!state.periode) t.push(['Rekap iuran ' + PERIODE + ' belum diimpor', 'iuran']); else if (state.periode.status !== 'terkunci') t.push(['Periode iuran ' + PERIODE + ' masih draf', 'iuran']); }
  if (izin('suratBuat') && (n = hitungSurat('dikembalikan'))) t.push([n + ' surat dikembalikan Ketua', 'surat']);
  if (izin('sosialKelola') && (n = state.sosial.filter(function (x) { return x.status === 'baru'; }).length)) t.push([n + ' pengajuan santunan perlu diverifikasi', 'sosial']);
  if (izin('donasiVerif') && (n = state.donasi.filter(function (x) { return x.status === 'menunggu'; }).length)) t.push([n + ' donasi menunggu verifikasi', 'donasi']);
  if (izin('disposisi') && (n = state.suratMasuk.filter(function (x) { return x.status === 'baru'; }).length)) t.push([n + ' surat masuk perlu disposisi', 'suratmasuk']);
  if ((n = state.suratMasuk.filter(function (x) { return x.status === 'didisposisi' && x.disposisi === state.role; }).length)) t.push([n + ' surat masuk didisposisikan ke Anda', 'suratmasuk']);
  if (izin('korlapKelola') && (n = state.aspirasi.filter(function (x) { return x.status === 'baru'; }).length)) t.push([n + ' aspirasi basis dari korlap perlu ditanggapi', 'korlap']);
  if (!t.length) return '';
  return '<section class="glass pad stack"><h2>Perlu tindakan Anda</h2>' + t.map(function (x) { return '<div class="agenda"><span class="bar"></span><div class="nm" style="flex:1;min-width:0">' + esc(x[0]) + '</div><a class="btn" href="#' + x[1] + '">Buka</a></div>'; }).join('') + '</section>';
}

// ---------- Aksi: validasi ringan di sini, lalu dikirim ke server ----------
async function cobaMasuk() {
  var nik = val('l-nik'), sandi = document.getElementById('l-sandi').value, tombol = document.getElementById('l-kirim');
  if (!nik || !sandi) { galat('login-err', 'Isi NIK dan sandi.'); return; }
  tombol.disabled = true; tombol.textContent = 'Memeriksa…';
  try { setToken((await api('POST', '/api/login', { nik: nik, sandi: sandi })).token); }
  catch (e) { tombol.disabled = false; tombol.textContent = 'Masuk'; galat('login-err', e.message); return; }
  await muat();
  if (!state.user) return;
  var awal = state.wajibGanti ? 'akun' : (state.role === 'anggota' ? 'saya' : 'dashboard');
  if (location.hash.slice(1) !== awal) location.hash = awal;
  toast('Masuk sebagai ' + LABEL[state.role]);
}
function keluar() { state.gagalMuat = false; setToken(''); terima({}); state.user = null; state.periodeKey = ''; render(); toast('Anda sudah keluar'); }
function gantiSandi() {
  var lama = document.getElementById('p-lama').value, baru = document.getElementById('p-baru').value, ulang = document.getElementById('p-ulang').value;
  var err = !lama ? 'Isi sandi sekarang.' : baru.length < 8 ? 'Sandi baru minimal 8 karakter.' : baru === lama ? 'Sandi baru harus berbeda dari sandi sekarang.' : baru !== ulang ? 'Ulangi sandi baru dengan tepat.' : '';
  if (err) { galat('sandi-err', err); return; }
  aksi('sandi-ganti', { lama: lama, baru: baru }, 'Sandi diganti', 'sandi-err');
}
function ubahPeran(nik, v) { aksi('peran-ubah', { nik: nik, peran: v }, 'Peran diperbarui'); }

function simpan() {
  var e = state.form, baru = !e.nik;
  var d = { baru: baru, nik: baru ? val('a-nik') : e.nik, nama: val('a-nama'), dept: val('a-dept'), plant: val('a-plant'), hp: val('a-hp'), kar: val('a-kar'), kontrakKe: null, akhir: '', mulai: val('a-mulai'), gabung: val('a-gabung'), status: val('a-status'), garda: val('a-garda') === '1' };
  var err = '';
  if (!/^\d{6,20}$/.test(d.nik)) err = 'NIK harus berupa 6 sampai 20 angka.';
  else if (!d.nama) err = 'Nama wajib diisi.';
  else if (!d.dept) err = 'Departemen wajib diisi.';
  else if (!d.plant) err = 'Plant wajib diisi.';
  else if (!d.mulai) err = 'Tanggal mulai bekerja wajib diisi.';
  else if (!d.gabung) err = 'Tanggal gabung PUK wajib diisi.';
  else if (d.kar === 'pkwt') {
    d.kontrakKe = parseInt(val('a-ke'), 10); d.akhir = val('a-akhir');
    if (!(d.kontrakKe >= 1)) err = 'Untuk PKWT, isi kontrak ke berapa (minimal 1).';
    else if (d.akhir && d.akhir < d.mulai) err = 'Akhir kontrak tidak boleh lebih awal dari tanggal mulai bekerja.';
  }
  if (err) { galat('frm-err', err); return; }
  aksi('anggota-simpan', d, baru ? 'Anggota ditambahkan' : 'Perubahan disimpan', 'frm-err', function () { state.form = null; });
}

async function simpanImpor() {
  var f = document.getElementById('i-file').files[0], bulan = val('i-bulan');
  var err = !bulan ? 'Pilih periode terlebih dahulu.' : !f ? 'Pilih file rekap terlebih dahulu.' : '';
  if (err) { galat('impor-err', err); return; }
  var fd = new FormData(); fd.append('periode', bulan); fd.append('file', f);
  try { await api('POST', '/api/iuran/impor', fd); } catch (e) { galat('impor-err', e.message); return; }
  state.periodeKey = bulan; state.jenis = '';
  await muat(); toast('Rekap diimpor dan dicocokkan');
}

function simpanKas() {
  var t = { tgl: val('k-tgl'), jenis: val('k-jenis'), kat: val('k-kat'), ket: val('k-ket'), nominal: parseInt(val('k-nom'), 10) };
  var err = !t.tgl ? 'Tanggal wajib diisi.' : !t.ket ? 'Keterangan wajib diisi.' : !(t.nominal > 0) ? 'Nominal harus lebih dari nol.' : '';
  if (err) { galat('kas-err', err); return; }
  var tunggu = t.jenis === 'keluar' && t.nominal >= BATAS;
  aksi('kas-catat', t, tunggu ? 'Dicatat, menunggu validasi Ketua' : 'Transaksi dicatat', 'kas-err', function () { state.kasForm = false; });
}
function aksiKas(act, id) { var ya = act === 'kasv-setuju'; aksi('kas-validasi', { id: id, setuju: ya }, ya ? 'Pengeluaran disetujui' : 'Pengeluaran ditolak'); }

function simpanSurat() {
  var p = val('sr-perihal'), t = val('sr-tujuan');
  var err = !p ? 'Perihal wajib diisi.' : !t ? 'Tujuan surat wajib diisi.' : '';
  if (err) { galat('surat-err', err); return; }
  aksi('surat-buat', { kode: val('sr-kode'), perihal: p, tujuan: t }, 'Surat diajukan ke Ketua', 'surat-err', function () { state.suratForm = false; });
}
function aksiSurat(act, id) {
  if (act === 'surat-tambah') { state.suratForm = true; render(); document.getElementById('sr-perihal').focus(); }
  else if (act === 'surat-batal') { state.suratForm = false; render(); }
  else if (act === 'surat-ttd') aksi('surat-ttd', { id: id }, 'Surat ditandatangani');
  else if (act === 'surat-kembali') aksi('surat-kembali', { id: id }, 'Surat dikembalikan');
}

function simpanAduan() {
  var j = val('d-judul'), i = val('d-isi');
  var err = !j ? 'Judul wajib diisi.' : !i ? 'Ceritakan masalahnya terlebih dahulu.' : '';
  if (err) { galat('adu-err', err); return; }
  aksi('aduan-kirim', { kat: val('d-kat'), judul: j, isi: i }, 'Pengaduan terkirim', 'adu-err');
}
function aksiAduan(act, id) {
  var e = 'e-' + id;
  if (act === 'adu-valid') {
    if (!isi('st-' + id)) { galat(e, 'Tulis analisis dan strategi terlebih dahulu.'); return; }
    aksi('aduan-valid', { id: id, strategi: isi('st-' + id), tanggapan: isi('t-' + id) }, 'Diajukan ke Ketua', e);
  } else if (act === 'adu-tolak') {
    if (!isi('t-' + id)) { galat(e, 'Tulis alasan penolakan di kolom tanggapan.'); return; }
    aksi('aduan-tolak', { id: id, tanggapan: isi('t-' + id) }, 'Kasus ditolak', e);
  } else if (act === 'adu-acc') aksi('aduan-acc', { id: id, catatan: isi('ck-' + id) }, 'Surat tugas ditandatangani', e);
  else if (act === 'adu-revisi') {
    if (!isi('ck-' + id)) { galat(e, 'Tulis catatan revisi untuk Bidang Hukum.'); return; }
    aksi('aduan-revisi', { id: id, catatan: isi('ck-' + id) }, 'Berkas dikembalikan untuk revisi', e);
  } else if (act === 'adu-selesai') aksi('aduan-selesai', { id: id, tanggapan: isi('t-' + id) }, 'Kasus selesai');
}

function simpanUmum() {
  var j = val('u-judul'), i = val('u-isi');
  var err = !j ? 'Judul wajib diisi.' : !i ? 'Isi pengumuman wajib diisi.' : '';
  if (err) { galat('umum-err', err); return; }
  aksi('umum-buat', { judul: j, isi: i }, 'Pengumuman diterbitkan', 'umum-err', function () { state.umumForm = false; });
}

function tutupForm() { state.bidangForm = ''; }
function simpanDiklat() {
  var j = val('dk-judul'), t = val('dk-tgl'), tp = val('dk-tempat'), k = parseInt(val('dk-kuota'), 10);
  var err = !j ? 'Judul wajib diisi.' : !t ? 'Tanggal wajib diisi.' : !tp ? 'Tempat wajib diisi.' : !(k > 0) ? 'Kuota harus lebih dari nol.' : '';
  if (err) { galat('diklat-err', err); return; }
  aksi('diklat-buat', { judul: j, tgl: t, tempat: tp, kuota: k }, 'Pelatihan dijadwalkan', 'diklat-err', tutupForm);
}
function simpanPkb() {
  var p = val('pk-pasal'), u = val('pk-usulan');
  var err = !p ? 'Pasal atau topik wajib diisi.' : !u ? 'Isi usulan wajib diisi.' : '';
  if (err) { galat('pkb-err', err); return; }
  aksi('pkb-tambah', { pasal: p, usulan: u }, 'Usulan ditambahkan', 'pkb-err', tutupForm);
}
function simpanSos() {
  var k = val('so-ket'); if (!k) { galat('sos-err', 'Keterangan wajib diisi.'); return; }
  aksi('santunan-ajukan', { jenis: val('so-jenis'), ket: k }, 'Pengajuan terkirim', 'sos-err', tutupForm);
}
function simpanKamp() {
  var j = val('km-judul'), t = parseInt(val('km-target'), 10);
  var err = !j ? 'Judul wajib diisi.' : !(t > 0) ? 'Target harus lebih dari nol.' : '';
  if (err) { galat('kamp-err', err); return; }
  aksi('kampanye-buat', { judul: j, target: t }, 'Penggalangan dibuka', 'kamp-err', tutupForm);
}
function simpanDon() {
  var n = parseInt(val('dn-nom'), 10); if (!(n > 0)) { galat('don-err', 'Nominal harus lebih dari nol.'); return; }
  aksi('donasi-catat', { kampanye: Number(val('dn-kamp')), nominal: n }, 'Donasi dicatat, menunggu verifikasi bendahara', 'don-err', tutupForm);
}
function simpanSm() {
  var no = val('sm-no'), pg = val('sm-pengirim'), ph = val('sm-perihal'), t = val('sm-tgl');
  var err = !no ? 'Nomor surat wajib diisi.' : !pg ? 'Pengirim wajib diisi.' : !ph ? 'Perihal wajib diisi.' : !t ? 'Tanggal diterima wajib diisi.' : '';
  if (err) { galat('sm-err', err); return; }
  aksi('suratmasuk-catat', { no: no, pengirim: pg, perihal: ph, tgl: t }, 'Surat masuk dicatat', 'sm-err', tutupForm);
}
function aksiBidang(act, b) {
  var id = Number(b.dataset.id);
  if (act === 'bd-buka') { state.bidangForm = b.dataset.f; render(); var f = document.querySelector('#view form input, #view form select, #view form textarea'); if (f) f.focus(); }
  else if (act === 'bd-tutup') { state.bidangForm = ''; render(); }
  else if (act === 'bd-kta') { state.ktaNik = b.dataset.nik; if (location.hash.slice(1) !== 'kta') location.hash = 'kta'; else render(); }
  else if (act === 'bd-ikut') aksi('diklat-ikut', { id: id }, 'Pendaftaran diperbarui');
  else if (act === 'bd-sos-setuju') {
    var nom = parseInt(isi('sn-' + id), 10);
    if (!(nom > 0)) { galat('se-' + id, 'Isi nominal santunan terlebih dahulu.'); return; }
    aksi('santunan-setuju', { id: id, nominal: nom, catatan: isi('sc-' + id) }, nom >= BATAS ? 'Disetujui, pengeluaran menunggu validasi Ketua' : 'Santunan disetujui', 'se-' + id);
  } else if (act === 'bd-sos-tolak') {
    if (!isi('sc-' + id)) { galat('se-' + id, 'Tulis alasan penolakan di kolom catatan.'); return; }
    aksi('santunan-tolak', { id: id, catatan: isi('sc-' + id) }, 'Pengajuan ditolak', 'se-' + id);
  } else if (act === 'bd-don-verif') aksi('donasi-verif', { id: id }, 'Donasi diverifikasi dan masuk kas');
  else if (act === 'bd-sm-selesai') aksi('suratmasuk-selesai', { id: id }, 'Surat ditandai selesai');
}
function ubahBidang(t) {
  if (t.dataset.pkb) aksi('pkb-status', { id: Number(t.dataset.pkb), status: t.value }, 'Status diperbarui');
  else if (t.dataset.disp && t.value) aksi('suratmasuk-disposisi', { id: Number(t.dataset.disp), tujuan: t.value }, 'Surat didisposisi');
}

function simpanIns() {
  var j = val('in-judul'), i = val('in-isi');
  var err = !j ? 'Judul wajib diisi.' : !i ? 'Isi instruksi wajib diisi.' : '';
  if (err) { galat('ins-err', err); return; }
  aksi('instruksi-kirim', { judul: j, isi: i }, 'Instruksi dikirim ke semua korlap', 'ins-err', tutupForm);
}
function simpanAsp() {
  var i = val('as-isi'); if (!i) { galat('asp-err', 'Tulis aspirasinya terlebih dahulu.'); return; }
  aksi('aspirasi-kirim', { isi: i }, 'Aspirasi terkirim ke pengurus', 'asp-err', tutupForm);
}
function simpanTugas() {
  var j = val('tg-judul'), t = val('tg-tgl'), l = val('tg-lokasi'), n = parseInt(val('tg-butuh'), 10);
  var err = !j ? 'Nama kegiatan wajib diisi.' : !t ? 'Tanggal wajib diisi.' : !l ? 'Lokasi wajib diisi.' : !(n > 0) ? 'Jumlah personel harus lebih dari nol.' : '';
  if (err) { galat('tugas-err', err); return; }
  aksi('tugas-buat', { judul: j, jenis: val('tg-jenis'), tgl: t, lokasi: l, butuh: n }, 'Penugasan dibuat', 'tugas-err', tutupForm);
}
async function aksiKorlap(act, b) {
  var nik = b.dataset.nik, v;
  if (act === 'pr-kl-buka') { state.korlapBuka = nik; render(); }
  else if (act === 'pr-kl-tutup') { state.korlapBuka = null; render(); }
  else if (act === 'pr-kl-cabut') { state.korlapCabut = nik; render(); }
  else if (act === 'pr-kl-cabut-batal') { state.korlapCabut = null; render(); }
  else if (act === 'pr-kl-tetap') {
    v = isi('kl-baru'); if (!v) { toast('Pilih anggotanya terlebih dahulu'); return; }
    await aksi('korlap-tetap', { nik: v }, 'Korlap ditetapkan', null, function () { state.korlapBuka = v; });
  } else if (act === 'pr-kl-cabut-ya') {
    await aksi('korlap-cabut', { nik: nik }, 'Penetapan korlap dicabut', null, function () { state.korlapCabut = null; if (state.korlapBuka === nik) state.korlapBuka = null; });
  } else if (act === 'pr-kl-tambah') {
    v = isi('kl-tambah'); if (!v) { toast('Pilih anggotanya terlebih dahulu'); return; }
    await aksi('korlap-tambah', { korlap: state.korlapBuka, nik: v }, 'Anggota ditambahkan ke basis');
  } else if (act === 'pr-kl-lepas') await aksi('korlap-lepas', { nik: nik }, 'Anggota dilepas dari basis');
  if (act === 'pr-kl-buka' || act === 'pr-kl-tetap') { var pn = document.getElementById('kl-panel'); if (pn) pn.scrollIntoView({ block: 'nearest' }); }
}
function aksiPerangkat(act, id, b) {
  if (act.indexOf('pr-kl-') === 0) aksiKorlap(act, b);
  else if (act === 'pr-ins-sampai') aksi('instruksi-sampai', { id: id }, 'Ditandai sudah disampaikan');
  else if (act === 'pr-asp-tindak') {
    if (!isi('at-' + id)) { galat('ae-' + id, 'Tulis tanggapan untuk korlap terlebih dahulu.'); return; }
    aksi('aspirasi-tindak', { id: id, tanggapan: isi('at-' + id) }, 'Aspirasi ditindaklanjuti', 'ae-' + id);
  } else if (act === 'pr-siap') aksi('tugas-siap', { id: id }, 'Kesiapan diperbarui');
}

// ---------- Router dan event ----------
var VIEWS = { dashboard: vDashboard, anggota: vAnggota, iuran: vIuran, kas: vKas, log: vLog, saya: vSaya, pengumuman: vPengumuman, pengaduan: vPengaduan, akun: vAkun, surat: vSurat, pengguna: vPengguna, pendidikan: vPendidikan, pkb: vPkb, sosial: vSosial, donasi: vDonasi, suratmasuk: vSuratMasuk, kta: vKta, korlap: vKorlap, garda: vGarda };
function menu() {
  if (state.wajibGanti) return [['akun', 'Akun', 'user', 'Sistem']];
  var nSos = izin('sosialKelola') ? state.sosial.filter(function (x) { return x.status === 'baru'; }).length : 0;
  if (state.role === 'anggota') return [['saya', 'Beranda Saya', 'home', 'Utama'], ['kta', 'KTA Digital', 'kartu', 'Utama'], ['pengumuman', 'Pengumuman', 'toa', 'Utama'], ['pengaduan', 'Pengaduan', 'chat', 'Utama'],
    ['pendidikan', 'Pendidikan', 'buku', 'Layanan'], ['pkb', 'Pengupahan & PKB', 'dok', 'Layanan'], ['sosial', 'Kesejahteraan', 'hati', 'Layanan'], ['donasi', 'Donasi', 'kado', 'Layanan']].concat(menuPerangkat(), [['akun', 'Akun', 'user', 'Sistem']]);
  var m = [['dashboard', 'Dashboard', 'home', 'Utama'], ['anggota', 'Data Anggota', 'people', 'Utama'], ['iuran', 'Iuran', 'wallet', 'Keuangan'], ['kas', 'Kas', 'coins', 'Keuangan', izin('kasValidasi') ? hitungKas() : 0],
    ['donasi', 'Donasi', 'kado', 'Keuangan', izin('donasiVerif') ? state.donasi.filter(function (x) { return x.status === 'menunggu'; }).length : 0]];
  if (izin('kasus')) m.push(['pengaduan', 'Advokasi', 'chat', 'Organisasi', izin('kasusAcc') ? hitungAduan(['menunggu_ketua']) : izin('kasusProses') ? hitungAduan(['baru', 'revisi']) : 0]);
  if (izin('surat')) m.push(['surat', 'Surat Keluar', 'mail', 'Organisasi', izin('suratTtd') ? hitungSurat('menunggu') : 0]);
  m.push(['suratmasuk', 'Surat Masuk', 'masuk', 'Organisasi', izin('disposisi') ? state.suratMasuk.filter(function (x) { return x.status === 'baru'; }).length : state.suratMasuk.filter(function (x) { return x.status === 'didisposisi' && x.disposisi === state.role; }).length]);
  m.push(['pengumuman', 'Pengumuman', 'toa', 'Organisasi']);
  if (izin('log')) m.push(['log', 'Log Aktivitas', 'clock', 'Organisasi']);
  m.push(['pendidikan', 'Pendidikan', 'buku', 'Bidang'], ['pkb', 'Pengupahan & PKB', 'dok', 'Bidang'], ['sosial', 'Kesejahteraan', 'hati', 'Bidang', nSos]);
  m = m.concat(menuPerangkat());
  if (izin('pengguna')) m.push(['pengguna', 'Pengguna', 'kunci', 'Sistem']);
  m.push(['akun', 'Akun', 'user', 'Sistem']);
  return m;
}
function route() { var r = location.hash.slice(1), m = menu(); if (r === 'kta' && !state.wajibGanti) return r; return m.some(function (x) { return x[0] === r; }) ? r : m[0][0]; }
function render() {
  var view = document.getElementById('view');
  document.querySelector('.app').classList.toggle('auth', !state.user);
  terapMini();
  document.querySelector('.side').hidden = !state.user;
  if (!state.user) { view.innerHTML = vLogin(); return; }
  var r = route();
  var NI = {
    home: '<path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
    people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18.5 14.8c1.7.8 2.7 2.4 3 5.2"/>',
    wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M16 12.5h2M3 10h18"/>',
    coins: '<ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>',
    chat: '<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-5 4v-4H6a2 2 0 0 1-2-2z"/>',
    toa: '<path d="M4 10v4h3l8 4V6l-8 4z"/><path d="M18.5 9.5a4 4 0 0 1 0 5"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 2"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
    jaring: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M12 7.5v4M12 11.5 6.5 16M12 11.5l5.5 4.5"/>',
    perisai: '<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z"/>',
    masuk: '<path d="M4 13v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/><path d="M4 13h4l1.5 3h5L16 13h4"/><path d="M12 3v7m-3-3 3 3 3-3"/>',
    buku: '<path d="M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2z"/><path d="M4 20a2 2 0 0 0 2 2h13"/>',
    dok: '<path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    hati: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.500-7 10-7 10z"/>',
    kado: '<rect x="4" y="9" width="16" height="11" rx="1.500"/><path d="M3 9h18M12 9v11M12 9c-1.500-4-6-4-5-1 .500 1 2.500 1 5 1zm0 0c1.500-4 6-4 5-1-.500 1-2.500 1-5 1z"/>',
    kartu: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.500-1.500 1.600-2 3-2s2.500.500 3 2M15 10h3M15 14h3"/>',
    kunci: '<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z"/><path d="m9.5 12 2 2 3.5-4"/>',
    user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.5-5.5 7-5.5s6.2 1.9 7 5.5"/>'
  };
  var grup = '';
  document.getElementById('nav').innerHTML = menu().map(function (m) {
    var lab = m[3] !== grup ? '<div class="navlabel">' + m[3] + '</div>' : ''; grup = m[3];
    return lab + '<a href="#' + m[0] + '" title="' + m[1] + '" aria-label="' + m[1] + '"' + (m[0] === r ? ' aria-current="page"' : '') + '><span class="ni" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + NI[m[2]] + '</svg></span><span class="nl">' + m[1] + '</span>' + (m[4] ? '<span class="badge" aria-label="' + m[4] + ' baru">' + m[4] + '</span>' : '') + '</a>';
  }).join('');
  var inisial = state.user.nama.split(' ').map(function (w) { return w[0]; }).slice(0, 2).join('');
  document.getElementById('userbox').innerHTML = '<div class="uwrap"><span class="ava" aria-hidden="true">' + esc(inisial) + '</span><div style="min-width:0"><div class="nm">' + esc(state.user.nama) + '</div><div class="small">' + LABEL[state.role] + '</div></div></div><button type="button" class="btn" data-act="keluar" aria-label="Keluar" title="Keluar"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9"/></svg><span class="nl">Keluar</span></button>';
  view.innerHTML = VIEWS[r]();
  if (r === 'anggota') tabelAnggota();
  if (r === 'kta') gambarKta();
  tabelPintar();
}
window.addEventListener('hashchange', function () { state.impang = false; state.impangHasil = null; state.impangFile = null; state.form = null; state.kasForm = false; state.umumForm = false; state.suratForm = false; state.bidangForm = ''; state.hapusUmum = null; state.confirmLock = false; render(); });

document.addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-act]'); if (!b || b.disabled) return;
  var act = b.dataset.act;
  if (act.indexOf('adu-') === 0) aksiAduan(act, Number(b.dataset.id));
  else if (act.indexOf('kasv-') === 0) aksiKas(act, Number(b.dataset.id));
  else if (act.indexOf('surat-') === 0) aksiSurat(act, Number(b.dataset.id));
  else if (act.indexOf('bd-') === 0) aksiBidang(act, b);
  else if (act.indexOf('pr-') === 0) aksiPerangkat(act, Number(b.dataset.id), b);
  else if (act === 'sandi-reset') aksi('sandi-reset', { nik: b.dataset.nik }, 'Sandi dikembalikan ke sandi awal');
  else if (act === 'pg') { state.pages[b.dataset.key] = (state.pages[b.dataset.key] || 1) + Number(b.dataset.d); tabelPintar(); }
  else if (act === 'lipat') { state.mini = !state.mini; try { localStorage.setItem('puk-mini', state.mini ? '1' : '0'); } catch (e) {} terapMini(); }
  else if (act === 'cetak') window.print();
  else if (act === 'umum-tambah') { state.umumForm = true; render(); document.getElementById('u-judul').focus(); }
  else if (act === 'umum-batal') { state.umumForm = false; render(); }
  else if (act === 'umum-hapus') { state.hapusUmum = Number(b.dataset.id); render(); }
  else if (act === 'umum-hapus-batal') { state.hapusUmum = null; render(); }
  else if (act === 'umum-hapus-ya') aksi('umum-hapus', { id: Number(b.dataset.id) }, 'Pengumuman dihapus', null, function () { state.hapusUmum = null; });
  else if (act === 'keluar') keluar();
  else if (act === 'kas-tambah') { state.kasForm = true; render(); document.getElementById('k-ket').focus(); }
  else if (act === 'kas-batal') { state.kasForm = false; render(); }
  else if (act === 'pasang') pasang();
  else if (act === 'coba-lagi') { state.memuat = true; render(); muat(); }
  else if (act === 'impang-buka') { state.impang = true; state.impangHasil = null; state.impangFile = null; state.form = null; render(); }
  else if (act === 'impang-tutup') { state.impang = false; state.impangHasil = null; state.impangFile = null; render(); }
  else if (act === 'impang-templat') unduhTemplat();
  else if (act === 'impang-simpan') periksaImporAnggota(true);
  else if (act === 'tambah') { state.form = { nik: null, data: { nik: '', nama: '', dept: '', plant: '', hp: '', korlap: '', kar: 'pkwt', kontrakKe: 1, akhir: '', mulai: iso(today), gabung: iso(today), status: 'aktif' } }; render(); document.getElementById('a-nik').focus(); }
  else if (act === 'ubah') { var a = byNik(b.dataset.nik); state.form = { nik: a.nik, data: Object.assign({}, a) }; render(); document.getElementById('a-nama').focus(); document.getElementById('frm').scrollIntoView({ block: 'start' }); }
  else if (act === 'batal') { state.form = null; render(); }
  else if (act === 'impor-ulang') aksi('iuran-cocokkan', { periode: state.periode.id }, 'Rekap dicocokkan ulang');
  else if (act === 'kunci') { state.confirmLock = true; render(); }
  else if (act === 'kunci-batal') { state.confirmLock = false; render(); }
  else if (act === 'kunci-ya') aksi('iuran-kunci', { periode: state.periode.id }, 'Periode dikunci', null, function () { state.confirmLock = false; });
});
document.addEventListener('submit', function (ev) {
  var F = { frm: simpan, login: cobaMasuk, frmimpor: simpanImpor, frmimpang: function () { periksaImporAnggota(false); }, frmkas: simpanKas, frmumum: simpanUmum, frmadu: simpanAduan, frmsandi: gantiSandi, frmsurat: simpanSurat, frmdiklat: simpanDiklat, frmpkb: simpanPkb, frmsos: simpanSos, frmdon: simpanDon, frmkamp: simpanKamp, frmsm: simpanSm, frmins: simpanIns, frmasp: simpanAsp, frmtugas: simpanTugas };
  var fn = F[ev.target.id]; if (fn) { ev.preventDefault(); fn(); }
});
document.addEventListener('input', function (ev) {
  if (ev.target.id === 'f-q') { state.filter.q = ev.target.value; state.pages = {}; tabelAnggota(); }
});
document.addEventListener('change', function (ev) {
  var t = ev.target, map = { 'f-plant': 'plant', 'f-korlap': 'korlap', 'f-kar': 'kar', 'f-ang': 'ang' };
  if (t.dataset && t.dataset.peran) ubahPeran(t.dataset.peran, t.value);
  else if (t.dataset && (t.dataset.pkb || t.dataset.disp)) ubahBidang(t);
  else if (t.dataset && t.dataset.ps) { state.pageSize = Number(t.value); state.pages = {}; tabelPintar(); }
  else if (t.dataset && t.dataset.cat) aksi('iuran-catatan', { id: Number(t.dataset.cat), catatan: t.value.trim() }, 'Catatan disimpan');
  else if (map[t.id]) { state.filter[map[t.id]] = t.value; state.pages = {}; tabelAnggota(); }
  else if (t.id === 'ia-file') { state.impangFile = t.files[0] || null; state.impangHasil = null; }
  else if (t.id === 'a-kar') { var on = t.value === 'pkwt'; document.getElementById('w-ke').hidden = !on; document.getElementById('w-akhir').hidden = !on; }
  else if (t.id === 'f-jenis') { state.jenis = t.value; render(); }
  else if (t.id === 'f-periode') { state.periodeKey = t.value; state.jenis = ''; state.confirmLock = false; muat(); }
});

cekOnline();
state.memuat = !!token;
render();
muat();
