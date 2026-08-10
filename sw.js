const CACHE = 'angelup-v37';
const BILD_CACHE = 'angelup-bilder-v1';
const DATEIEN = ['./', './index.html', './app.html', './lernen.html', './kurs.html',
  './live.html', './aal.html', './kurse.html', './vormerken.html',
  './videokurse.html', './videokurs.html', './player.html',
  './kursinhalt.js', './stil.css', './impressum.html', './datenschutz.html', './agb.html',
  './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(DATEIEN)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== BILD_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  // Fischbilder von Wikimedia dauerhaft zwischenspeichern (cache-first) -> funktionieren offline
  if (u.hostname === 'upload.wikimedia.org') {
    e.respondWith(caches.open(BILD_CACHE).then(c =>
      c.match(e.request).then(treffer => treffer || fetch(e.request).then(netz => {
        // auch "opaque" Antworten (Bilder ohne CORS, status 0) zwischenspeichern
        if (netz && (netz.ok || netz.type === 'opaque')) c.put(e.request, netz.clone());
        return netz;
      }).catch(() => treffer))));
    return;
  }
  // Andere Wikimedia-/Wikipedia-Anfragen (z. B. API) nicht cachen
  if (u.hostname.endsWith('wikimedia.org') || u.hostname.endsWith('wikipedia.org')) return;
  // Studio nie zwischenspeichern - dort wird verwaltet und hochgeladen
  if (u.origin === location.origin && u.pathname.endsWith('/studio.html')) return;
  // Livekurs-Seite immer frisch aus dem Netz holen, Cache nur als Notfall
  if (u.origin === location.origin && u.pathname.endsWith('/live.html')) {
    e.respondWith(fetch(e.request).then(netz => {
      const kopie = netz.clone();
      caches.open(CACHE).then(c => c.put(e.request, kopie));
      return netz;
    }).catch(() => caches.match('./live.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(netz => {
    if (e.request.method === 'GET' && netz.ok && u.origin === location.origin) {
      const kopie = netz.clone();
      caches.open(CACHE).then(c => c.put(e.request, kopie));
    }
    return netz;
  }).catch(() => caches.match('./app.html').then(r => r || caches.match('./index.html')))));
});
