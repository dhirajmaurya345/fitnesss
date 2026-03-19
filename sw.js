const CACHE_NAME = 'fitness-v4';
const BASE = '/fitnesss';

// Assets to cache immediately on install
const STATIC_ASSETS = [
  `${BASE}/`,
  `${BASE}/index.html`,
  `${BASE}/icon.svg`,
  `${BASE}/manifest.json`
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('Failed to cache static assets:', err);
      });
    })
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Cache-first strategy for static assets and videos
  if (
    request.destination === 'image' ||
    request.destination === 'video' ||
    request.destination === 'font' ||
    request.destination === 'style' ||
    request.destination === 'script' ||
    url.pathname.match(/\.(gif|jpg|jpeg|png|webp|svg|mp4|webm|css|js|woff2?|ttf|eot)$/i)
  ) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(request).then((cached) => {
          if (cached) {
            // Return cached immediately
            // Update in background for next time
            fetch(request).then((response) => {
              if (response && response.ok && response.status === 200) {
                cache.put(request, response.clone());
              }
            }).catch(() => {});
            return cached;
          }
          
          // Not in cache, fetch and cache
          return fetch(request).then((response) => {
            if (response && response.ok && response.status === 200) {
              // Clone before caching
              const responseClone = response.clone();
              cache.put(request, responseClone);
            }
            return response;
          }).catch(() => {
            // Return offline fallback if available
            return new Response('Offline - Content not cached', { 
              status: 503,
              statusText: 'Service Unavailable'
            });
          });
        });
      })
    );
    return;
  }

  // Network-first for HTML/API with cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(request).then((cached) => {
          return cached || caches.match(`${BASE}/index.html`);
        });
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => 
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('Deleting old cache:', key);
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

// Listen for messages from the app to pre-cache videos
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'PRECACHE_VIDEOS') {
    const urls = event.data.urls;
    console.log(`📦 Pre-caching ${urls.length} videos...`);
    
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => {
        // Separate local and external videos
        const localVideos = urls.filter(url => !url.startsWith('http') || url.includes(location.hostname));
        const externalVideos = urls.filter(url => url.startsWith('http') && !url.includes(location.hostname));
        
        console.log(`📹 Local videos: ${localVideos.length}, External: ${externalVideos.length}`);
        
        // Process videos in batches to avoid overwhelming the browser
        const batchSize = 5;
        const batches = [];
        
        for (let i = 0; i < localVideos.length; i += batchSize) {
          batches.push(localVideos.slice(i, i + batchSize));
        }
        
        // Process batches sequentially
        return batches.reduce((promise, batch) => {
          return promise.then(() => {
            return Promise.allSettled(
              batch.map((url) => 
                fetch(url, { 
                  mode: 'cors',
                  credentials: 'omit'
                })
                  .then((response) => {
                    if (response && response.ok) {
                      return cache.put(url, response);
                    }
                  })
                  .catch((err) => {
                    console.warn(`⚠️ Failed to cache: ${url}`, err.message);
                  })
              )
            );
          });
        }, Promise.resolve()).then(() => {
          if (externalVideos.length > 0) {
            console.warn(`⚠️ ${externalVideos.length} external videos cannot be cached due to CORS.`);
            console.warn('💡 Consider downloading videos locally for offline support.');
          }
          console.log('✅ Video pre-caching complete');
          // Notify the app that pre-caching is complete
          self.clients.matchAll().then((clients) => {
            clients.forEach((client) => {
              client.postMessage({ 
                type: 'PRECACHE_COMPLETE',
                localCached: localVideos.length,
                externalSkipped: externalVideos.length
              });
            });
          });
        });
      })
    );
  }
  
  // Handle skip waiting message
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
