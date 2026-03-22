const CACHE_NAME = 'super-planner-v2';
const urlsToCache = [
  './',
  './index.html',
  './login.html',
  './manifest.json',
  './logo.png',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js',
  'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'
];

// Install event - cache resources
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
      .catch(err => {
        console.log('Cache install error:', err);
      })
  );
  // Activate immediately
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // Take control immediately
  return self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', event => {
  // Skip cross-origin requests except for Firebase and fonts
  if (!event.request.url.startsWith(self.location.origin) && 
      !event.request.url.includes('firebase') &&
      !event.request.url.includes('googleapis') &&
      !event.request.url.includes('cdnjs') &&
      !event.request.url.includes('mixkit')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Return cached version or fetch from network
        if (response) {
          return response;
        }
        
        return fetch(event.request).then(response => {
          // Don't cache non-successful responses
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          
          // Clone the response
          var responseToCache = response.clone();
          
          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(event.request, responseToCache);
            });
            
          return response;
        });
      })
      .catch(() => {
        // Return offline page if available
        return caches.match('./index.html');
      })
  );
});

// Handle push notifications
self.addEventListener('push', event => {
  const options = {
    body: event.data ? event.data.text() : '你有新的任务提醒！',
    icon: './logo.png',
    badge: './logo.png',
    vibrate: [200, 100, 200],
    requireInteraction: true,
    actions: [
      { action: 'open', title: '打开应用' },
      { action: 'dismiss', title: '关闭' }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification('Super Planner', options)
  );
});

// Handle notification click
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  if (event.action === 'open' || !event.action) {
    event.waitUntil(
      clients.openWindow('./index.html')
    );
  }
});

// Background sync for offline data
self.addEventListener('sync', event => {
  if (event.tag === 'sync-tasks') {
    event.waitUntil(
      // Sync logic would go here
      console.log('Background sync triggered')
    );
  }
});
