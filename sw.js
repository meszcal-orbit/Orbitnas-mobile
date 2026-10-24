// Offline-Modus: Die App selbst liegt auf dem Gerät. Deine Daten (IndexedDB) fasst dieser Teil nie an.
const BUILD = "e84736f05375";
const APP_CACHE = 'orbitnas-app-' + BUILD;
const THUMBS = 'orbitnas-thumbs';
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/app.css",
  "./icons/apple-touch-icon.png",
  "./icons/favicon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./js/app.js",
  "./js/backup.js",
  "./js/crypto.js",
  "./js/db.js",
  "./js/demo.js",
  "./js/files.js",
  "./js/locations.js",
  "./js/lock.js",
  "./js/log.js",
  "./js/login.js",
  "./js/opsbar.js",
  "./js/pairing.js",
  "./js/pcloud.js",
  "./js/player.js",
  "./js/secq.js",
  "./js/settings.js",
  "./js/sync.js",
  "./js/theme.js",
  "./js/ui.js",
  "./js/unzip.js",
  "./js/upload.js",
  "./js/util.js",
  "./js/version.js",
  "./vendor/LIZENZEN.txt",
  "./vendor/jsQR.js"
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(ASSETS.map((a) => new Request(a, { cache: 'reload' })))));
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('orbitnas-app-') && k !== APP_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trimThumbs(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - 1500; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Vorschaubilder aus pCloud: einmal geladen, auch offline sichtbar
  if (url.pathname.endsWith('/getthumb') && url.hostname.endsWith('pcloud.com')) {
    e.respondWith((async () => {
      const cache = await caches.open(THUMBS);
      const hit = await cache.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) { cache.put(e.request, res.clone()); trimThumbs(cache); }
      return res;
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  // App-Dateien: zuerst vom Gerät (schnell, offline)
  e.respondWith((async () => {
    const cache = await caches.open(APP_CACHE);
    if (e.request.mode === 'navigate') {
      return (await cache.match('./index.html')) || fetch(e.request);
    }
    const hit = await cache.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(e.request);
    } catch {
      return new Response('', { status: 504 });
    }
  })());
});
