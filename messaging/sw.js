// Crossroads Private Line service worker: push alerts + installable app.
const IOS = /iPhone|iPad|iPod/.test(self.navigator.userAgent);

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const visible = wins.some(w => w.visibilityState === 'visible');
    // App is on screen: it rings / updates by itself. (iPhone must always show something.)
    if (visible && !IOS) return;
    await self.registration.showNotification(d.title || 'Private line', {
      body: d.body || '',
      tag: d.tag,
      renotify: true,
      requireInteraction: !!d.call,
      vibrate: d.call ? [600, 300, 600, 300, 600, 300, 600, 300, 600] : [200, 100, 200],
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { url: d.url || './' },
    });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) {
        try { await w.navigate(url); } catch {}
        return w.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
