// Network-first for the app's own files (so updates arrive), cache as offline fallback.
// Google Sheets requests are not handled here; core.js keeps its own offline copy of the data.
const C = 'dash-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((k) => Promise.all(k.filter((x) => x !== C).map((x) => caches.delete(x)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(C).then((x) => x.put(e.request, c)); } return r; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./')))
  );
});
