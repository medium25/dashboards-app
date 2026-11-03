// Kill switch: the app no longer uses a service worker (it was the main suspect for blank screens on iPhone).
// Any worker already installed on a device updates to this one, which deletes all caches, removes itself and reloads open windows.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
  await self.registration.unregister();
  const wins = await self.clients.matchAll({ type: 'window' });
  wins.forEach((w) => { try { w.navigate(w.url); } catch (err) {} });
})()));
