// Baby Care Log service worker: offline app shell + reminder notifications
const CACHE = 'babylog-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE && k !== 'babylog-key') await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(event.request);
      if (res.ok) { const c = await caches.open(CACHE); c.put(url.pathname === '/' || !url.pathname.includes('.') ? '/' : event.request, res.clone()); }
      return res;
    } catch (e) {
      return (await caches.match(event.request)) || (await caches.match('/'));
    }
  })());
});

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: 'Baby Care Log', body: event.data ? event.data.text() : '' }; }
  const options = {
    body: d.body || '',
    tag: d.tag || 'babylog',
    renotify: true,
    requireInteraction: !!d.kind,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [300, 150, 300, 150, 300],
    data: { url: d.url || '/', kind: d.kind || null },
  };
  if (d.kind) options.actions = [{ action: 'log', title: d.kind === 'pump' ? 'Log pumping' : 'Log feed' }, { action: 'snooze', title: 'Snooze 15 min' }];
  event.waitUntil(self.registration.showNotification(d.title || 'Baby Care Log', options));
});

async function familyKey() {
  try { const c = await caches.open('babylog-key'); const r = await c.match('/__key'); return r ? await r.text() : ''; } catch (e) { return ''; }
}

self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  const data = n.data || {};
  n.close();
  event.waitUntil((async () => {
    if (event.action === 'snooze' && data.kind) {
      const key = await familyKey();
      try {
        await fetch('/api/snooze', { method: 'POST', headers: { 'content-type': 'application/json', 'x-family-key': key }, body: JSON.stringify({ kind: data.kind, minutes: 15 }) });
        return;
      } catch (e) { /* fall through and open the app */ }
    }
    const target = event.action === 'log' && data.kind ? '/?log=' + data.kind : data.url || '/';
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === location.origin) {
        await w.focus();
        if (target !== '/') { try { await w.navigate(target); } catch (e) {} }
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
