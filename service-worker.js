// Basic PWA service worker for offline caching and notification click handling.

const CACHE_NAME = 'sevasathi-cache-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  // Network-first for API requests, cache-first for app shell
  if (event.request.url.includes('/firebase') || event.request.method !== 'GET') {
    return;
  }
  event.respondWith(
    caches.match(event.request).then(resp => {
      return resp || fetch(event.request).then(response => {
        // cache new files on the fly
        return caches.open(CACHE_NAME).then(cache => {
          if (event.request.url.startsWith(self.location.origin)) {
            cache.put(event.request, response.clone());
          }
          return response;
        });
      }).catch(()=> caches.match('/index.html'));
    })
  );
});

// Notification click behavior
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const target = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then( windowClients => {
      for (let client of windowClients) {
        // If app is open, focus it
        if (client.url === '/' && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});