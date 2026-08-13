const CACHE_NAME = 'wordstar-v20';

// The update banner runs in the OLD page, so it can't read the new build's CHANGELOG.
// Keep a one-line summary here — the waiting SW is already the new version and can
// answer GET_INFO, so the banner can say what the update contains before reloading.
const APP_VERSION = 'v20';
const UPDATE_NOTE = '動漫卡池新增兩組：草帽海賊團、復仇者聯盟（各 10 位）';

self.addEventListener('message', e => {
  // Let the page trigger activation of a freshly-installed SW ("點擊更新" banner)
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data && e.data.type === 'GET_INFO' && e.ports && e.ports[0]) {
    e.ports[0].postMessage({ version: APP_VERSION, note: UPDATE_NOTE });
  }
});

// Core assets pre-cached on install
const CORE_ASSETS = [
  './',
  './word-star.html',
  './manifest.json',
  './sentences.json',
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
// - Page navigations: network-first (always load the latest HTML when online, so updates
//     take effect on refresh; fall back to cached page only when offline)
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

  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        // Network-first: fetch the latest HTML when online and refresh the cache; only fall
        // back to the cached page (or precached HTML) when the network is unavailable.
        fetch(e.request).then(resp => {
          if (resp.ok) cache.put(e.request, resp.clone());
          return resp;
        }).catch(() =>
          cache.match(e.request).then(cached =>
            cached || cache.match('./word-star.html').then(fallback => fallback || new Response(
              '<h1>離線中</h1><p>請連接網路後重新整理</p>',
              { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            ))
          )
        )
      )
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
        return new Response('', { status: 503 });
      })
    )
  );
});
