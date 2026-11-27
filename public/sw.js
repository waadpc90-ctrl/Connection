/* Wisaal Service Worker — External Web Push Notifications & Resilient App Shell */

const CACHE_NAME = 'wisaal-shell-v2';
const RELATIVE_SHELL_ASSETS = [
  'manifest.webmanifest',
  'icon.svg',
  'pwa-192x192.png',
  'pwa-512x512.png',
  'apple-touch-icon.png',
];

function getScopeBase() {
  return self.registration && self.registration.scope
    ? self.registration.scope
    : `${self.location.origin}/`;
}

function resolveInScope(relativePath) {
  const clean = String(relativePath || '').replace(/^\.?\//, '');
  return new URL(clean, getScopeBase()).href;
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(RELATIVE_SHELL_ASSETS.map((p) => resolveInScope(p))))
      .catch(() => undefined)
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      ),
    ])
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never cache backend API routes or cross-origin Firebase/Firestore requests
  if (url.origin !== self.location.origin || url.pathname.includes('/api/')) {
    return;
  }

  const matchesShell = RELATIVE_SHELL_ASSETS.some((asset) => url.pathname.endsWith(`/${asset}`));
  if (matchesShell) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
  }
});

// Receive real external Web Push payloads even when the browser/app is closed
self.addEventListener('push', (event) => {
  let payload = {
    title: 'إشعار جديد من المدرسة — وصال',
    body: 'اضغط للاطلاع على آخر تحديثات المدرسة.',
    url: './',
    tag: 'wisaal-alert',
    requireInteraction: false,
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      if (parsed && typeof parsed === 'object') {
        payload = {
          title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title : payload.title,
          body: typeof parsed.body === 'string' && parsed.body.trim() ? parsed.body : payload.body,
          url: typeof parsed.url === 'string' && parsed.url.trim() ? parsed.url.trim() : './',
          tag: typeof parsed.tag === 'string' && parsed.tag.trim() ? parsed.tag : payload.tag,
          requireInteraction: Boolean(parsed.requireInteraction),
        };
      }
    } catch {
      const fallbackText = event.data.text();
      if (fallbackText) {
        payload.body = fallbackText;
      }
    }
  }

  const iconUrl = resolveInScope('pwa-192x192.png');
  const options = {
    body: payload.body,
    icon: iconUrl,
    badge: iconUrl,
    dir: 'rtl',
    lang: 'ar',
    tag: payload.tag,
    renotify: true,
    requireInteraction: payload.requireInteraction,
    vibrate: [180, 90, 180],
    data: {
      url: payload.url,
    },
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

// Focus an open Wisaal window or open the exact Stage/Pass URL when parent taps the notification
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const rawTarget =
    (event.notification && event.notification.data && event.notification.data.url) || './';
  const targetUrl = resolveInScope(rawTarget);

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      for (const client of clientList) {
        if (client.url.startsWith(getScopeBase()) && 'navigate' in client && 'focus' in client) {
          return client.navigate(targetUrl).then((navigated) => (navigated ? navigated.focus() : client.focus()));
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
