// Offline support. App files: served from cache, refreshed in the background.
// Posters (Wikipedia or TMDB): cached the first time they're seen, capped so the cache can't grow forever.

const APP_CACHE = 'smc-app-v4';
const POSTER_CACHE = 'smc-posters-v1';
const MAX_POSTERS = 700;
const POSTER_HOSTS = new Set(['image.tmdb.org', 'upload.wikimedia.org', 'thumb.wikimedia.org']);
const APP_FILES = [
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'data/movies.json',
  'fonts/nunito.woff2',
  'fonts/playfair.woff2',
  'fonts/playfair-italic.woff2',
  'fonts/caveat.woff2',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  // cache: 'reload' bypasses the HTTP cache, so a new version never precaches stale copies
  const fresh = APP_FILES.map(f => new Request(f, { cache: 'reload' }));
  event.waitUntil(caches.open(APP_CACHE).then(c => c.addAll(fresh)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== APP_CACHE && k !== POSTER_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (POSTER_HOSTS.has(url.hostname)) {
    event.respondWith(posterFirst(request));
  } else if (url.origin === location.origin) {
    // navigations always get the app shell
    const key = request.mode === 'navigate' ? new URL('index.html', self.registration.scope).href : request;
    event.respondWith(staleWhileRevalidate(key, request, event));
  }
});

async function staleWhileRevalidate(key, request, event) {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(key, { ignoreSearch: true });
  // no-cache: revalidate with the server (a cheap 304 when unchanged) instead of trusting the HTTP cache
  const network = fetch(key, { cache: 'no-cache' })
    .then(res => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  return (await network) || new Response('Offline', { status: 503, statusText: 'Offline' });
}

async function posterFirst(request) {
  const cache = await caches.open(POSTER_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok) {
      await cache.put(request, res.clone());
      trim(cache);
    }
    return res;
  } catch {
    return new Response('', { status: 504 });
  }
}

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_POSTERS; i++) await cache.delete(keys[i]);
}
