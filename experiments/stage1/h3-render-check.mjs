/**
 * H3 实验：零依赖渲染门禁可行性
 *   A. Edge headless 截图（视觉证据落盘）
 *   B. DOM 指标探针：复制页面 → 注入 window.load 后把指标写进 <title> → Edge --dump-dom → 解析
 *      指标：图片加载失败数 / 横向溢出 / 空白率(首屏全白检测在截图侧做) / 控件数
 *   C. 检出力验证：构造坏页面（坏图 + 超宽元素），探针必须报警
 * 产出：h3-result.json + shots/*.png
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const shots = path.join(HERE, 'shots');
fs.mkdirSync(shots, { recursive: true });

const PROBE = `<script>window.addEventListener('load', () => { setTimeout(() => {
  const imgs = [...document.images];
  const failed = imgs.filter(i => !i.complete || i.naturalWidth === 0).length;
  const overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
  const t = 'PROBE::' + JSON.stringify({ imgs: imgs.length, failed, overflowX,
    scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
    buttons: document.querySelectorAll('button,input,select,textarea').length, h: document.documentElement.scrollHeight });
  document.title = t; const h1 = document.querySelector('title'); if (h1) h1.textContent = t;
}, 1200); });</script>`;

/** 复制工作区页面 + 注入探针 + 起本地服务 */
async function withProbeServer(wsDir, port, fn) {
  const server = http.createServer((req, res) => {
    let p = req.url.split('?')[0];
    if (p === '/') p = '/index.html';
    const file = path.join(wsDir, decodeURIComponent(p).replace(/^\//, ''));
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
    if (file.endsWith('.html')) {
      let html = fs.readFileSync(file, 'utf8');
      html = html.includes('</head>') ? html.replace('</head>', PROBE + '</head>') : PROBE + html;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    const ext = { '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.webmanifest': 'application/json' }[path.extname(file)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ext });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  try { return await fn(); } finally { server.close(); }
}

async function edgeShot(url, out, size = '1440,900') {
  const t0 = performance.now();
  const { execFile } = await import('node:child_process');
  await new Promise((resolve) => execFile(EDGE, [
    '--headless=new', '--disable-gpu', `--screenshot=${out}`, `--window-size=${size}`,
    '--virtual-time-budget=8000', url,
  ], { timeout: 45_000 }, () => resolve()));
  return Math.round(performance.now() - t0);
}

async function edgeDom(url) {
  const t0 = performance.now();
  const { execFile } = await import('node:child_process');
  const dom = await new Promise((resolve, reject) => execFile(EDGE, [
    '--headless=new', '--disable-gpu', '--dump-dom', '--virtual-time-budget=8000', url,
  ], { timeout: 45_000, maxBuffer: 20 * 1024 * 1024 }, (e, stdout) => (e ? reject(e) : resolve(stdout))));
  const m = dom.match(/PROBE::(\{[^<]*)/);
  return { ms: Math.round(performance.now() - t0), metrics: m ? JSON.parse(m[1]) : null, domLen: dom.length };
}

const result = { screenshot: {}, probe: {}, verdict: {} };

// A+B: 真实页面（漫威图鉴）
const marvelWs = path.join(ROOT, 'workspaces', 'PMVD10MOR');
await withProbeServer(marvelWs, 8901, async () => {
  result.screenshot.desktopMs = await edgeShot('http://127.0.0.1:8901/', path.join(shots, 'h3-marvel-1440.png'), '1440,900');
  result.screenshot.mobileMs = await edgeShot('http://127.0.0.1:8901/', path.join(shots, 'h3-marvel-390.png'), '390,844');
  const shotSize = fs.statSync(path.join(shots, 'h3-marvel-1440.png')).size;
  result.screenshot.pngBytes = shotSize;
  result.probe.marvel = await edgeDom('http://127.0.0.1:8901/');
});

// C: 坏页面检出力（坏图 + 2000px 超宽元素 + 正常按钮）
const fixture = path.join(HERE, 'fixture-bad');
fs.mkdirSync(fixture, { recursive: true });
fs.writeFileSync(path.join(fixture, 'index.html'), `<!doctype html><html><head><title>bad</title><style>body{margin:0}</style></head>
<body><h1>坏页面</h1><img src="missing.jpg"><img src="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'/>">
<div style="width:2000px;height:50px;background:red"></div><button onclick="1">ok</button></body></html>`);
await withProbeServer(fixture, 8902, async () => {
  result.probe.badFixture = await edgeDom('http://127.0.0.1:8902/');
});

result.verdict = {
  screenshotOk: result.screenshot.pngBytes > 100_000,
  probeParses: !!result.probe.marvel.metrics,
  badFixtureDetected: result.probe.badFixture.metrics
    && result.probe.badFixture.metrics.failed >= 1
    && result.probe.badFixture.metrics.overflowX === true,
};
fs.writeFileSync(path.join(HERE, 'h3-result.json'), JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
