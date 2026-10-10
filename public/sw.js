/* Sanjeev Astra Service Worker - Offline Shell & Safe Asset Cache */

const CACHE_NAME = 'sanjeev-astra-shell-v1';

// Static Application Shell Assets to Pre-cache
const STATIC_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/appointments.html',
  '/records.html',
  '/prescriptions.html',
  '/medicines.html',
  '/profile.html',
  '/settings.html',
  '/login.html',
  '/register.html',
  '/doctor-login.html',
  '/doctor-register.html',
  '/doctor-dashboard.html',
  '/offline.html',
  '/manifest.json',
  '/favicon.ico',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
  '/css/variables.css',
  '/css/doctor.css',
  '/css/main.css',
  '/css/components.css',
  '/css/pages.css',
  '/js/doctor.js',
  '/js/api.js',
  '/js/db.js',
  '/js/syncEngine.js',
  '/js/networkStatus.js',
  '/js/dexie.mjs',
  '/js/dexie.min.js',
  '/js/i18n.js',
  '/js/chat.js',
  '/js/dashboard.js',
  '/js/appointments.js',
  '/js/records.js',
  '/js/prescriptions.js',
  '/js/medicines.js',
  '/js/profile.js',
  '/js/settings.js',
  '/js/sos.js',
  '/js/voice.js',
  '/js/elevenVoice.js',
  '/locales/en.json',
  '/locales/hi.json',
  '/locales/mr.json'
];

// 1. INSTALL EVENT - Pre-cache App Shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Cache assets gracefully (tolerate any single missing asset without failing install)
      for (const asset of STATIC_SHELL_ASSETS) {
        try {
          await cache.add(asset);
        } catch (err) {
          console.warn('[ServiceWorker] Could not pre-cache:', asset, err.message);
        }
      }
    })
  );
  self.skipWaiting();
});

// 2. ACTIVATE EVENT - Clean obsolete caches & claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key.startsWith('sanjeev-astra-') && key !== CACHE_NAME) {
            console.log('[ServiceWorker] Deleting obsolete cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. FETCH EVENT - Strategy Routing
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // CRITICAL SECURITY RULE: NEVER cache /api/ endpoints or authenticated responses in Service Worker Cache
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
    // API calls pass directly to network; client IndexedDB handles encrypted/scoped persistence
    return;
  }

  // A. Navigation Requests (HTML pages) - Network-First with Offline Fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return response;
        })
        .catch(async () => {
          // Check if specific HTML page is in cache
          const cachedResponse = await caches.match(request);
          if (cachedResponse) {
            return cachedResponse;
          }
          // Fallback to offline.html
          const offlineFallback = await caches.match('/offline.html');
          if (offlineFallback) {
            return offlineFallback;
          }
          return new Response('Offline: Sanjeev Astra is currently disconnected.', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain' }
          });
        })
    );
    return;
  }

  // B. Static Assets (CSS, JS, Fonts, Images) - Stale-While-Revalidate
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        })
        .catch(() => {
          // Offline network error - ignore if cached version exists
        });

      return cachedResponse || fetchPromise;
    })
  );
});

// 4. BACKGROUND SYNC EVENT - Trigger Sync in Clients
self.addEventListener('sync', (event) => {
  if (event.tag === 'sanjeev-sync-queue') {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'BACKGROUND_SYNC_TRIGGER' });
        });
      })
    );
  }
});
