/**
 * PWA 资产生成：manifest + service worker（离线缓存）。
 * 使每个生成的 App 可安装：Windows → 桌面/开始菜单应用；Android → 主屏应用（Chrome 生成 WebAPK）。
 */
import { appIconFor } from './png.mjs';
import { styleAccentOf } from './styles.mjs';

export function pwaAssets(spec) {
  const uid = Date.now().toString(36);
  const accent = styleAccentOf(spec);
  const bg = '#0f1226';
  const manifest = {
    name: spec.title,
    short_name: spec.title.slice(0, 6),
    description: `${spec.title} — OrchestrAI 生成`,
    start_url: './index.html',
    scope: './',
    display: 'standalone',
    background_color: bg,
    theme_color: accent,
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  };
  const imageAssets = (spec.images ?? []).map((i) => `./${i.file}`);
  const extraAssets = [...new Set([...(spec.extraAssets ?? []), ...imageAssets])];
  const sw = `// ${spec.title} · Service Worker（离线缓存，生成于 ${new Date().toISOString()}）
const CACHE = 'app-${uid}-v1';
const ASSETS = [
  './', './index.html', './style.css', './app.mjs', './logic.mjs',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  ${extraAssets.map((a) => `'${a}',`).join('\n  ')}
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
`;
  return {
    'manifest.webmanifest': JSON.stringify(manifest, null, 2),
    'sw.js': sw,
    'icons/icon-192.png': appIconFor(spec.template.meta.type, 192, accent),
    'icons/icon-512.png': appIconFor(spec.template.meta.type, 512, accent),
  };
}

/** index.html 头部注入的 PWA/SEO 标记（含 SW 注册：仅 http(s) 环境，file:// 双击打开时不报错） */
export function pwaHead(spec) {
  const emoji = spec.template.meta.type === 'pomodoro' ? '%F0%9F%8D%85'
    : spec.template.meta.type === 'todo' ? '%E2%9C%85'
    : spec.template.meta.type === 'counter' ? '%F0%9F%94%A2'
    : spec.template.meta.type === 'gallery' ? '%F0%9F%96%BC'
    : spec.template.meta.type === 'countdown' ? '%F0%9F%97%93'
    : spec.template.meta.type === 'landing' ? '%F0%9F%9A%80'
    : spec.template.meta.type === 'atlas' ? '%F0%9F%8C%8C'
    : '%F0%9F%93%9D';
  const accent = styleAccentOf(spec);
  const desc = `${spec.title} — OrchestrAI 生成${spec.galleryQuery ? `（素材主题：${spec.galleryQuery}）` : ''}`;
  return `<meta name="description" content="${desc}" />
<meta property="og:title" content="${spec.title}" />
<meta property="og:description" content="${desc}" />
<meta property="og:type" content="website" />
<meta property="og:image" content="./icons/icon-512.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="format-detection" content="telephone=no" />
<link rel="manifest" href="./manifest.webmanifest" />
<link rel="icon" type="image/png" sizes="192x192" href="./icons/icon-192.png" />
<link rel="apple-touch-icon" href="./icons/icon-192.png" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${emoji}</text></svg>" />
<meta name="theme-color" content="${accent}" />
<script>if ('serviceWorker' in navigator && location.protocol.startsWith('http')) { addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {})); }</script>`;
}
