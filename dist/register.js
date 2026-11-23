if ('serviceWorker' in navigator && !window.TRACEX_TEAM && location.hostname !== 'appassets.androidplatform.net') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
