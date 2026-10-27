/**
 * Simply Viewer Service Worker (sw.js)
 * - Offline-first App Shell caching
 * - Android Web Share Target API POST interception
 * - Handles MULTIPLE queued file parsing directly to IndexedDB
 */

// BUMPED CACHE VERSION: Forces the browser to clear old files and cache the new app.js, index.html, and styles.css
const CACHE_NAME = 'simply-viewer-cache-v2.1.0';
const DB_NAME = 'OmniviewDB';
const DB_VERSION = 2;
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

function openDatabase() {
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

async function enqueueSharedFile(file, meta = {}) {
  const db = await openDatabase();
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
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const asset of APP_SHELL_ASSETS) {
        try { await cache.add(asset); } catch (err) {}
      }
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => key !== CACHE_NAME ? caches.delete(key) : null))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  if (event.request.method === 'POST' && (url.pathname.endsWith('/share-target') || url.pathname === '/share-target')) {
    event.respondWith(handleShareTargetPost(event));
    return;
  }
  
  if (event.request.method === 'GET') {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
        return cachedResponse || fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        }).catch(() => {
          if (event.request.mode === 'navigate') return caches.match('./index.html');
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        });
      })
    );
  }
});

async function handleShareTargetPost(event) {
  try {
    const formData = await event.request.formData();
    const mediaFiles = formData.getAll('media');
    const fallbackFile = formData.get('file') || formData.get('files');
    const title = formData.get('title') || '';
    
    let processedCount = 0;

    if (mediaFiles && mediaFiles.length > 0) {
      for (const file of mediaFiles) {
        if (file instanceof File || file instanceof Blob) {
          await enqueueSharedFile(file, { title });
          processedCount++;
        }
      }
    }

    if (processedCount === 0 && (fallbackFile instanceof File || fallbackFile instanceof Blob)) {
      await enqueueSharedFile(fallbackFile, { title });
      processedCount++;
    }

    if (processedCount === 0) {
      for (const [, value] of formData.entries()) {
        if (value instanceof File || value instanceof Blob) {
          await enqueueSharedFile(value, { title });
          processedCount++;
        }
      }
    }

    if (processedCount > 0) {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientList) {
        client.postMessage({ type: 'SHARED_FILE_READY', timestamp: Date.now() });
      }
    }
    return Response.redirect('./?shared=1', 303);
  } catch (error) {
    return Response.redirect('./?shared=error', 303);
  }
}