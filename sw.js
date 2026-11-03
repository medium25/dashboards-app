// Network-first for the app's own files, always bypassing the HTTP cache so updates arrive on the next launch.
// When a new version of this worker takes over it clears old caches and reloads open app windows,
// which repairs an installed home-screen app that is stuck on an old or broken version (no reinstall needed).
const C = 'dash-v4';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter((x) => x !== C).map((x) => caches.delete(x)));
  await self.clients.claim();
  const wins = await self.clients.matchAll({ type: 'window' });
  wins.forEach((w) => { try { w.navigate(w.url); } catch (err) {} });
})()));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-store' })
      .then((r) => { if (r.ok) { const c = r.clone(); caches.open(C).then((x) => x.put(e.request, c)); } return r; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./')))
  );
});
