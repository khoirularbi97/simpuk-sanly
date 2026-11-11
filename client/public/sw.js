// Service worker SIMPUK: menyimpan tampilan aplikasi supaya cepat terbuka dan tetap muncul saat sinyal hilang.
// Data dari API (backend di Render) tidak pernah disimpan di sini, jadi data anggota tidak tertinggal di perangkat.
const VERSI = 'simpuk-v1';
const SHELL = ['/', '/manifest.webmanifest', '/logo-mark.png', '/logo-full.png', '/bg.jpg', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSI).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSI).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const simpan = (req, res) => {
  if (res && (res.ok || res.type === 'opaque')) caches.open(VERSI).then((c) => c.put(req, res));
};
// Cache dulu: untuk file yang namanya berubah tiap rilis (/assets/...) dan font.
const cacheDulu = (req) => caches.match(req).then((hit) => hit || fetch(req).then((res) => { simpan(req, res.clone()); return res; }));
// Tampilkan yang tersimpan, lalu perbarui di belakang.
const segarkan = (req) => caches.match(req).then((hit) => {
  const baru = fetch(req).then((res) => { simpan(req, res.clone()); return res; }).catch(() => hit);
  return hit || baru;
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);

  if (u.origin !== self.location.origin) {
    if (/^fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) e.respondWith(cacheDulu(req));
    return;   // permintaan ke API dan domain lain tidak disentuh
  }
  if (u.pathname.startsWith('/api/')) return;

  // Halaman: selalu coba versi terbaru dari jaringan, pakai yang tersimpan bila offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { simpan('/', res.clone()); return res; })
        .catch(() => caches.match('/'))
    );
    return;
  }
  if (u.pathname.startsWith('/assets/')) { e.respondWith(cacheDulu(req)); return; }
  e.respondWith(segarkan(req));
});
