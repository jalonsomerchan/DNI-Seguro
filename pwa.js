const splash = document.querySelector('#app-splash');
const startedAt = performance.now();

function hideSplash() {
  const delay = Math.max(0, 450 - (performance.now() - startedAt));
  setTimeout(() => splash?.classList.add('loaded'), delay);
}

if (document.readyState === 'complete') hideSplash();
else window.addEventListener('load', hideSplash, { once: true });
setTimeout(hideSplash, 2500);

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(error => {
    console.warn('No se ha podido activar el modo offline.', error);
  }), { once: true });
}
