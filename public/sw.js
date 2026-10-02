// Service worker mínimo: deixa o app instalável. Página e API sempre vêm da rede (nunca uma versão velha
// depois de um deploy); só os ícones ficam em cache. Mudar a versão força os aparelhos a baixarem ícones novos.
const CACHE = 'speak-static-v1';
const CACHEABLE = ['/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-192.png', '/icons/icon-maskable-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CACHEABLE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (CACHEABLE.includes(url.pathname)) event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request)));
  // Todo o resto: rede
});

// Lembrete diário (push do servidor)
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data.json(); } catch { data = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Speak AI', {
    body: data.body || '', icon: '/icons/icon-192.png', badge: '/icons/icon-maskable-192.png',
    tag: data.tag || 'speak', data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.startsWith(self.location.origin));
    if (open) return open.focus().then((c) => c.navigate(url)).catch(() => self.clients.openWindow(url));
    return self.clients.openWindow(url);
  }));
});
