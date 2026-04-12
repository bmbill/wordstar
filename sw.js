const CACHE_NAME = 'wordstar-v4';

// Install: activate immediately
self.addEventListener('install', e => {
  self.skipWaiting();
});

// Activate: clean ALL old caches, take control immediately
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-only strategy
// Always fetch from server, never use cache
self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).catch(() => {
      // Offline fallback: try to return something useful
      if (e.request.mode === 'navigate') {
        return new Response('<h1>離線中</h1><p>請連接網路後重新整理</p>', {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }
      return new Response('', { status: 503 });
    })
  );
});
