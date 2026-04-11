const CACHE_NAME = 'wordstar-v2';
const ASSETS = [
  './word-star.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Install: cache all core assets, activate immediately
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches, take control immediately
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: stale-while-revalidate strategy
// 1. Return cached version immediately (fast load)
// 2. Fetch latest version in background
// 3. If new version is different, update cache & notify user
self.addEventListener('fetch', e => {
  e.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(e.request).then(cached => {
        const fetchPromise = fetch(e.request).then(response => {
          if (response.ok) {
            cache.put(e.request, response.clone());
            // Notify all clients that an update is available
            if (cached && e.request.mode === 'navigate') {
              self.clients.matchAll().then(clients => {
                clients.forEach(client => client.postMessage({ type: 'UPDATE_AVAILABLE' }));
              });
            }
          }
          return response;
        }).catch(() => {
          // Offline: return cached or fallback
          if (!cached && e.request.mode === 'navigate') {
            return cache.match('./word-star.html');
          }
          return cached;
        });
        // Return cached immediately, update in background
        return cached || fetchPromise;
      })
    )
  );
});
