// Service worker: shows push notifications and opens the right page when one is tapped.
// It deliberately caches nothing, so the app always shows the latest version of the site.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data && event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'CarsFindMe', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/favicon-32.png',
      tag: data.tag,
      renotify: Boolean(data.tag),
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        try {
          await open.focus();
          return await open.navigate(url);
        } catch {
          /* fall through and open a new window */
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
