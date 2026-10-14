// Crossroads Private Line service worker: push alerts + installable app.
const IOS = /iPhone|iPad|iPod/.test(self.navigator.userAgent);

// A web page can't play a real ringtone while the phone is locked, so an incoming
// call "rings" by re-alerting the same notification every few seconds: each one
// plays the phone's notification sound and vibrates again.
const RING_EVERY_MS = 5000;
const RING_FOR_MS = 45000;   // the push function stops alerting 45s after a call starts
const ringing = new Map();   // tag -> true while that call is still ringing here

const sleep = ms => new Promise(r => setTimeout(r, ms));

function noteOptions(d) {
  return {
    body: d.body || '',
    tag: d.tag,
    renotify: true,
    silent: false,
    requireInteraction: !!d.call,
    vibrate: d.call ? [600, 300, 600, 300, 600, 300, 600, 300, 600] : [200, 100, 200],
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: { url: d.url || './' },
  };
}

async function appVisible() {
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return wins.some(w => w.visibilityState === 'visible');
}

// The alert is gone if it was tapped, swiped away, or closed by the app
// (it closes them when the call is answered or declined there).
async function stillShowing(tag) {
  try { return (await self.registration.getNotifications({ tag })).length > 0; } catch { return false; }
}

async function ring(d) {
  const tag = d.tag;
  ringing.set(tag, true);
  const until = Date.now() + RING_FOR_MS;
  try {
    while (Date.now() + RING_EVERY_MS < until) {
      await sleep(RING_EVERY_MS);
      if (!ringing.get(tag) || !(await stillShowing(tag)) || await appVisible()) return;
      await self.registration.showNotification(d.title || 'Private line', noteOptions(d));
    }
  } finally {
    ringing.delete(tag);
  }
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil((async () => {
    // Any later alert for the same call (e.g. "Missed call") stops its ringing.
    if (!d.call && d.tag) ringing.delete(d.tag);
    // App is on screen: it rings / updates by itself. (iPhone must always show something.)
    if (await appVisible() && !IOS) return;
    await self.registration.showNotification(d.title || 'Private line', noteOptions(d));
    // Keep ringing unless a loop for this call is already running. iPhone stops
    // service workers right away, so there the push function repeats the alert instead.
    if (d.call && d.tag && !IOS && !ringing.has(d.tag)) await ring(d);
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.notification.tag) ringing.delete(e.notification.tag);
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

self.addEventListener('notificationclose', e => {
  if (e.notification.tag) ringing.delete(e.notification.tag);
});
