/**
 * 渲染门禁（阶段二正式最小版）：
 *   Edge headless 截图（显式视口） + DOM 探针（注入 <title> 指标，--dump-dom 回读）
 * 诚实性约定：
 *   - 四项独立状态 screenshot / probe / images / overflow，取值 ok | fail | skipped(reason) | invalid
 *   - 环境缺失（无 Edge）、超时、探针失效 → 明确 not_run / fail，绝不假绿
 *   - 本门禁只证明"渲染成功、必需图片加载、无横向溢出"，不证明视觉质量（无自动评分，不虚构）
 * 图片三态：required（非懒加载，或懒加载但位于首屏视口内）/ lazy（懒加载且在首屏下）——
 *   判定只看 required；按设计懒加载的图未加载不计失败（阶段一已知误报的修正）。
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const PROBE = `<script>window.addEventListener('load', () => { setTimeout(() => {
  const vh = window.innerHeight;
  const imgs = [...document.images].filter((i) => i.getAttribute('src') || i.srcset); // 无 src 的骨架 img（如未打开的灯箱）不计
  const required = imgs.filter((i) => i.loading !== 'lazy' || i.getBoundingClientRect().top < vh);
  const lazy = imgs.filter((i) => i.loading === 'lazy' && i.getBoundingClientRect().top >= vh);
  const failedOf = (a) => a.filter((i) => !i.complete || i.naturalWidth === 0).length;
  const doc = document.documentElement;
  const t = 'RC::' + JSON.stringify({
    required: required.length, requiredFailed: failedOf(required),
    lazy: lazy.length, lazyFailed: failedOf(lazy),
    overflowX: doc.scrollWidth > doc.clientWidth + 1,
    scrollW: doc.scrollWidth, clientW: doc.clientWidth, pageH: doc.scrollHeight,
    buttons: document.querySelectorAll('button,input,select,textarea').length,
  });
  document.title = t; const h = document.querySelector('title'); if (h) h.textContent = t;
}, 1500); });</script>`;

const MIME = { '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.webmanifest': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function edgeBin() {
  return process.env.RENDERCHECK_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
}

function edge(env, args, timeoutMs) {
  return new Promise((resolve) => {
    const bin = edgeBin();
    if (!fs.existsSync(bin)) return resolve({ error: 'env', detail: `未找到浏览器：${bin}` });
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 24 * 1024 * 1024 }, (e, stdout) => {
      if (e) return resolve({ error: 'timeout-or-crash', detail: String(e.message ?? e).slice(0, 120) });
      resolve({ stdout });
    });
  });
}

/** 本地静态服务 + 探针注入（仅对页面 HTML 注入，其余资源原样） */
function serveWs(wsDir, port) {
  const server = http.createServer((req, res) => {
    let p = req.url.split('?')[0];
    if (p === '/') p = '/index.html';
    const file = path.join(wsDir, decodeURIComponent(p).replace(/^\//, ''));
    if (!file.startsWith(wsDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('nf'); return;
    }
    if (file.endsWith('.html')) {
      let html = fs.readFileSync(file, 'utf8');
      html = html.includes('</head>') ? html.replace('</head>', PROBE + '</head>') : PROBE + html;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}

/**
 * @param {{wsDir?: string, url?: string, label: string, outDir: string,
 *          viewports?: Array<{name:string,w:number,h:number}>, timeoutMs?: number,
 *          commit?: string, requirement?: string}} opts
 * @returns {Promise<{gate: {pass: boolean, status: 'pass'|'fail'|'not_run', reason: string}, viewports: Array<Object>}>}
 *   结果同时落盘 outDir/rendercheck.json（含截图路径/指标/时间/提交标识）
 */
export async function renderCheck(opts) {
  const {
    wsDir = null, url = null, label = 'page', outDir,
    viewports = [{ name: 'desktop', w: 1440, h: 900 }, { name: 'mobile', w: 390, h: 844 }],
    timeoutMs = 45_000, commit = '', requirement = '',
  } = opts;
  fs.mkdirSync(outDir, { recursive: true });
  const report = { label, at: new Date().toISOString(), commit, requirement, viewports: [] };
  let server = null;
  let base = url;
  if (wsDir) {
    const port = 8930 + Math.floor(Math.random() * 60);
    server = await serveWs(path.resolve(wsDir), port);
    base = `http://127.0.0.1:${port}/`;
  } else if (!url) {
    report.gate = { pass: false, status: 'not_run', reason: '未提供 wsDir 或 url' };
    fs.writeFileSync(path.join(outDir, `${label}-rendercheck.json`), JSON.stringify(report, null, 1));
    return report;
  }

  try {
    for (const vp of viewports) {
      const shot = path.join(outDir, `${label}-${vp.name}.png`);
      const t0 = performance.now();
      const sr = await edge(process.env, [
        '--headless=new', '--disable-gpu', `--screenshot=${shot}`,
        `--window-size=${vp.w},${vp.h}`, '--virtual-time-budget=9000', base,
      ], timeoutMs);
      const screenshot = fs.existsSync(shot)
        ? { status: 'ok', file: path.basename(shot), bytes: fs.statSync(shot).size, ms: Math.round(performance.now() - t0) }
        : { status: sr.error === 'env' ? 'skipped' : 'fail', reason: sr.detail ?? '截图未生成' };

      let probe = { status: 'skipped', reason: '无工作区（探针需注入本地页面）' };
      let images = { status: 'skipped', reason: '同上' };
      let overflow = { status: 'skipped', reason: '同上' };
      if (wsDir) {
        const dr = await edge(process.env, [
          '--headless=new', '--disable-gpu', '--dump-dom',
          `--window-size=${vp.w},${vp.h}`, '--virtual-time-budget=9000', base,
        ], timeoutMs);
        const m = dr.stdout?.match(/RC::(\{[^<]*)/);
        if (!dr.stdout) probe = { status: dr.error === 'env' ? 'skipped' : 'fail', reason: dr.detail ?? 'dump-dom 失败' };
        else if (!m) probe = { status: 'invalid', reason: '探针指标未出现在 DOM（页面异常或脚本被 CSP 拦截）' };
        else {
          const met = JSON.parse(m[1]);
          probe = { status: 'ok', metrics: met };
          images = met.required === 0
            ? { status: 'ok', note: '页面无必需图片', required: 0, requiredFailed: 0 }
            : (met.requiredFailed > 0
              ? { status: 'fail', required: met.required, requiredFailed: met.requiredFailed, note: '首屏必需图片未加载（懒加载图不计入）' }
              : { status: 'ok', required: met.required, requiredFailed: 0, lazy: met.lazy, lazyFailed: met.lazyFailed });
          overflow = met.overflowX
            ? { status: 'fail', scrollW: met.scrollW, clientW: met.clientW }
            : { status: 'ok', scrollW: met.scrollW, clientW: met.clientW };
        }
      }
      report.viewports.push({ viewport: vp, base, screenshot, probe, images, overflow });
    }
  } finally {
    if (server) server.close();
  }

  // 门禁合成：任一视口 screenshot fail / images fail / overflow fail / probe invalid → fail；
  // 环境缺失（全部 skipped）→ not_run；其余 → pass。
  const v = report.viewports;
  const anyFail = v.some((x) => x.screenshot.status === 'fail' || x.images.status === 'fail' || x.overflow.status === 'fail' || x.probe.status === 'invalid' || x.probe.status === 'fail');
  const allSkipped = v.every((x) => x.screenshot.status !== 'ok' && x.probe.status !== 'ok');
  report.gate = anyFail
    ? { pass: false, status: 'fail', reason: '存在渲染缺陷（见各视口明细：截图失败/必需图片未加载/横向溢出/探针失效）' }
    : allSkipped
      ? { pass: false, status: 'not_run', reason: '渲染环境不可用（浏览器缺失或未注入探针），本轮未执行——不判通过' }
      : { pass: true, status: 'pass', reason: '渲染成功：截图生成 + 首屏必需图片全部加载 + 无横向溢出（不构成视觉质量结论）' };
  fs.writeFileSync(path.join(outDir, `${label}-rendercheck.json`), JSON.stringify(report, null, 1));
  return report;
}
