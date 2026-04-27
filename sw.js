// Study Plan PWA Service Worker
// HTML and Supabase responses must stay fresh. Only static non-HTML assets are cached.
const CACHE_NAME = 'study-plan-v20260427-pwa-refresh-v2';
const ASSETS_TO_CACHE = [
  './manifest.json',
  './icon-512.png'
];

// 安装：缓存核心资源
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE.map(asset => new Request(asset, { cache: 'reload' })));
    })
  );
  self.skipWaiting();
});

// 激活：清理旧缓存
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// 请求拦截：网络优先，失败则用缓存
self.addEventListener('fetch', event => {
  // 跳过非 GET 请求、非 http/https 请求
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) return;

  const url = new URL(event.request.url);

  // Supabase 读取也不能缓存，否则 PWA 回到前台会看到旧云端数据
  if (url.hostname.endsWith('.supabase.co')) return;

  const isDocumentRequest =
    event.request.mode === 'navigate' ||
    event.request.destination === 'document' ||
    (event.request.headers.get('accept') || '').includes('text/html');

  if (url.origin === location.origin && isDocumentRequest) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).catch(() =>
        caches.match(event.request).then(cached =>
          cached || new Response('离线状态下无法加载最新页面，请联网后重试。', {
            status: 503,
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }
          })
        )
      )
    );
    return;
  }

  // 对于外部 CDN 资源（字体、图标库等），使用缓存优先
  if (url.origin !== location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => cached);
      })
    );
    return;
  }

  // 本地资源：网络优先，离线时用缓存
  event.respondWith(
    fetch(event.request, { cache: 'no-cache' }).then(response => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => caches.match(event.request))
  );
});
