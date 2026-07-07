// Service worker mínimo del KDS: su único propósito es habilitar la
// instalación como PWA en la tablet del taller. No cachea nada — el KDS
// necesita datos en vivo (órdenes, estados), así que todo pasa directo a red.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
