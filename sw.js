/**
 * Omniview Service Worker (sw.js)
 * - Offline-first App Shell caching
 * - Android Web Share Target API POST interception (/share-target)
 * - Zero-bloat raw File storage into IndexedDB (OmniviewDB -> shared_queue)
 */

const CACHE_NAME = 'omniview-cache-v1.0.0';
const DB_NAME = 'OmniviewDB';
const DB_VERSION = 1;
const STORE_SHARED = 'shared_queue';
const STORE_HISTORY = 'recent_history';

const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './assets/logo.svg',
  './assets/shortcut-open.svg',
  './assets/shortcut-recent.svg',
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js'
];

/**
 * Open OmniviewDB in the Service Worker context.
 * Creates both `shared_queue` and `recent_history` object stores so schema is unified.
 */
function openOmniviewDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_SHARED)) {
        db.createObjectStore(STORE_SHARED, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORE_HISTORY)) {
        const historyStore = db.createObjectStore(STORE_HISTORY, { keyPath: 'id' });
        historyStore.createIndex('timestamp', 'timestamp', { unique: false });
        historyStore.createIndex('category', 'category', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Store a raw File/Blob directly into `shared_queue` without Base64 conversion.
 */
async function enqueueSharedFile(file, meta = {}) {
  const db = await openOmniviewDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SHARED, 'readwrite');
    const store = tx.objectStore(STORE_SHARED);
    const record = {
      file: file,
      name: file.name || meta.title || 'shared-media',
      type: file.type || 'application/octet-stream',
      size: file.size || 0,
      timestamp: Date.now()
    };
    const req = store.add(record);
    tx.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const asset of APP_SHELL_ASSETS) {
        try {
          await cache.add(asset);
        } catch (err) {
          console.warn('[Omniview SW] Optional asset skipped during install:', asset, err);
        }
      }
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return null;
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Intercept Web Share Target POST requests targeting /share-target
  if (
    event.request.method === 'POST' &&
    (url.pathname.endsWith('/share-target') || url.pathname === '/share-target')
  ) {
    event.respondWith(handleShareTargetPost(event));
    return;
  }

  // Standard GET caching strategy: Cache-First for App Shell, Network fallback
  if (event.request.method === 'GET') {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request)
          .then((networkResponse) => {
            if (
              networkResponse &&
              networkResponse.status === 200 &&
              networkResponse.type === 'basic'
            ) {
              const clone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return networkResponse;
          })
          .catch(() => {
            if (event.request.mode === 'navigate') {
              return caches.match('./index.html');
            }
            return new Response('Offline', { status: 503, statusText: 'Offline' });
          });
      })
    );
  }
});

/**
 * Process multipart/form-data POST from Android Share Sheet:
 * 1. Extract raw File object(s) from formData
 * 2. Write directly to IndexedDB `OmniviewDB -> shared_queue`
 * 3. Broadcast `SHARED_FILE_READY` to active clients
 * 4. Return HTTP 303 See Other redirect to `./?shared=1`
 */
async function handleShareTargetPost(event) {
  try {
    const formData = await event.request.formData();
    const mediaFiles = formData.getAll('media');
    const fallbackFile = formData.get('file') || formData.get('files');
    const title = formData.get('title') || '';

    let extractedFile = null;
    if (mediaFiles && mediaFiles.length > 0) {
      extractedFile = mediaFiles.find((item) => item instanceof File || item instanceof Blob);
    }
    if (!extractedFile && (fallbackFile instanceof File || fallbackFile instanceof Blob)) {
      extractedFile = fallbackFile;
    }

    // Also scan all formData entries in case the OS used a custom field key
    if (!extractedFile) {
      for (const [, value] of formData.entries()) {
        if (value instanceof File || value instanceof Blob) {
          extractedFile = value;
          break;
        }
      }
    }

    if (extractedFile) {
      await enqueueSharedFile(extractedFile, { title });

      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true
      });
      for (const client of clientList) {
        client.postMessage({
          type: 'SHARED_FILE_READY',
          timestamp: Date.now()
        });
      }
    }

    return Response.redirect('./?shared=1', 303);
  } catch (error) {
    console.error('[Omniview SW] Failed to process shared file:', error);
    return Response.redirect('./?shared=error', 303);
  }
}
