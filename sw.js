const CACHE = 'angelup-v7';
const DATEIEN = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(DATEIEN)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(netz => {
    if (e.request.method === 'GET' && netz.ok && new URL(e.request.url).origin === location.origin) {
      const kopie = netz.clone();
      caches.open(CACHE).then(c => c.put(e.request, kopie));
    }
    return netz;
  }).catch(() => caches.match('./index.html'))));
});
