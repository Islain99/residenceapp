// Service worker du journal de bord (PWA installable).
//
// Règle Loi 25 : AUCUNE réponse de l'API (/api/*) n'est mise en cache. Seuls
// les fichiers de l'interface (code, styles, icônes) le sont, pour un
// démarrage rapide. Sans réseau, la page « Hors connexion » s'affiche.
const VERSION = 'v2';   // v2 : nouveau logo (logo.png, icônes)
const CACHE = `journal-${VERSION}`;
const PRECACHE = ['/offline.html', '/logo.png', '/icons/favicon-64.png', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('journal-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;   // données : toujours le réseau, jamais le cache

  // Pages : le réseau d'abord (version à jour), sinon la page hors connexion
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
    return;
  }

  // Fichiers de l'interface : noms versionnés par Vite (/assets/…-hash.js), donc immuables
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname === '/logo.png') {
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
        }
        return response;
      })),
    );
  }
});
