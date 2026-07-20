const CACHE_VERSION = 'dni-seguro-v8';
const APP_SHELL = [
  './', './index.html', './styles.css', './app.js', './lite.js', './ocr-helpers.js', './pwa.js',
  './manifest.webmanifest', './offline.html', './site-page.css', './faq.html', './privacidad.html',
  './como-censurar-dni.html', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_VERSION).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_VERSION).then(cache => cache.put(event.request, copy));
      return response;
    }).catch(async () => (await caches.match(event.request)) || (await caches.match('./index.html')) || caches.match('./offline.html')));
    return;
  }

  if (url.origin === location.origin) {
    event.respondWith(fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_VERSION).then(cache => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request)));
    return;
  }

  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_VERSION).then(cache => cache.put(event.request, copy));
      return response;
    })));
  }
});
