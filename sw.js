// 极简 PWA Service Worker：预缓存核心资源 + 缓存优先
const CACHE_NAME = 'othello-pwa-v2';
const CORE_ASSETS = [
  './',
  'index.html',
  'assets/styles.css',
  'assets/manifest.webmanifest',
  'assets/icons/icon-192.svg',
  'assets/icons/icon-512.svg',
  // 源码与打包版（HTTP 页面按需加载）
  'src/main.js',
  'src/ui.js',
  'src/othello.js',
  'src/ai.parallel.js',
  'src/ai.worker.js',
  'src/ai.bitboard.js',
  'dist/app.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map(k => (k === CACHE_NAME ? undefined : caches.delete(k))))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // 仅处理 GET，避免干扰 POST/导航等
  if (req.method !== 'GET') return;
  e.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req).then((resp) => {
        const respClone = resp.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(req, respClone).catch(()=>{});
        });
        return resp;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
