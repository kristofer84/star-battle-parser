const CACHE = 'star-battle-v1';
const ASSETS = ['./', './index.html', './parser.js', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.filter(a => !a.endsWith('.png')))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (url.pathname.endsWith('/share') && e.request.method === 'POST') {
    e.respondWith(
      (async () => {
        const data = await e.request.formData();
        const file = data.get('image');
        const buffer = await file.arrayBuffer();
        const base64 = bufferToBase64(buffer);
        const mime = file.type || 'image/png';

        const allClients = await clients.matchAll({ type: 'window' });
        if (allClients.length > 0) {
          allClients[0].postMessage({ type: 'shared-image', dataUrl: `data:${mime};base64,${base64}` });
          return Response.redirect(self.registration.scope, 303);
        }

        // Store for when the page opens
        await storeSharedImage(`data:${mime};base64,${base64}`);
        return Response.redirect(self.registration.scope, 303);
      })()
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'get-shared-image') {
    getSharedImage().then(dataUrl => {
      if (dataUrl) e.source.postMessage({ type: 'shared-image', dataUrl });
    });
  }
});

// Simple IndexedDB-based temporary image storage
function storeSharedImage(dataUrl) {
  return new Promise((res, rej) => {
    const req = indexedDB.open('star-battle', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('shared');
    req.onsuccess = e => {
      const tx = e.target.result.transaction('shared', 'readwrite');
      tx.objectStore('shared').put(dataUrl, 'pending');
      tx.oncomplete = res;
      tx.onerror = rej;
    };
    req.onerror = rej;
  });
}

function getSharedImage() {
  return new Promise((res) => {
    const req = indexedDB.open('star-battle', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('shared');
    req.onsuccess = e => {
      const db = e.target.result;
      const tx = db.transaction('shared', 'readwrite');
      const store = tx.objectStore('shared');
      const get = store.get('pending');
      get.onsuccess = () => {
        if (get.result) store.delete('pending');
        res(get.result || null);
      };
      get.onerror = () => res(null);
    };
    req.onerror = () => res(null);
  });
}

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
