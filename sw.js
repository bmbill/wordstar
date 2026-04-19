const CACHE_NAME = 'wordstar-v7';

// Core assets pre-cached on install
const CORE_ASSETS = [
  './',
  './word-star.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './audio/pk-01.mp3',
  './audio/pk-02.mp3',
  './audio/pk-03.mp3',
  './audio/pk-04.mp3',
  './audio/sfx/attack-1.mp3',
  './audio/sfx/attack-2.mp3',
  './audio/sfx/attack-4.mp3',
  './audio/sfx/attack-6.mp3',
  './audio/sfx/damage.mp3',
];

// Install: pre-cache core assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(CORE_ASSETS).catch(err => {
        console.warn('[SW] precache failed for some assets', err);
      })
    ).then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch strategy:
// - Audio files: cache-first (never fetch again once cached)
// - Everything else: network-first, fall back to cache
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const isAudio = url.pathname.includes('/audio/') && (url.pathname.endsWith('.mp3') || url.pathname.endsWith('.ogg'));

  if (isAudio) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return resp;
      }))
    );
    return;
  }

  e.respondWith(
    fetch(e.request).then(resp => {
      if (resp.ok && e.request.method === 'GET') {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
      }
      return resp;
    }).catch(() =>
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        if (e.request.mode === 'navigate') {
          return new Response('<h1>離線中</h1><p>請連接網路後重新整理</p>', {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        }
        return new Response('', { status: 503 });
      })
    )
  );
});
