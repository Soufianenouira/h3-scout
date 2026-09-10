// H3 Scout Service Worker — cached App-Shell für vollständige Offline-Nutzung.
const CACHE = 'h3scout-cache-v3';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Netzwerk-first, damit du online immer sofort die neueste Version bekommst
// (wichtig, solange die App noch weiterentwickelt wird). Nur wenn gar keine
// Verbindung besteht (z.B. Halle ohne Netz), wird auf den Cache zurückgefallen.
//
// WICHTIG (Fix aus der QA gefundenen Stale-Cache-Problems): ein einfaches fetch() respektiert den
// GANZ NORMALEN HTTP-Cache des Browsers selbst — "network-first" auf Service-Worker-Ebene hilft
// nichts, wenn der Browser die Anfrage darunter bereits (unbemerkt) aus seinem eigenen HTTP-Cache
// beantwortet, ohne wirklich ins Netz zu gehen. {cache:'no-store'} erzwingt einen echten
// Netzwerk-Roundtrip, sodass eine neue Bereitstellung (neues app.js) zuverlässig ankommt.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request, { cache: 'no-store' }).then((response) => {
      if (response && response.status === 200) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match(event.request))
  );
});
