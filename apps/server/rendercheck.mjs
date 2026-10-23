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
import { fileURLToPath } from 'node:url';
import { launchCdp, captureAtViewport } from './cdp-viewport.mjs';

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
 *          commit?: string, requirement?: string, desktopOnly?: boolean}} opts
 * @returns {Promise<{gate: {pass: boolean, status: 'pass'|'fail'|'not_run', reason: string}, viewports: Array<Object>}>}
 *   结果同时落盘 outDir/rendercheck.json（含截图路径/指标/时间/提交标识）
 *
 * 内测版范围：只验收桌面版网页。默认单视口 1440×900；
 * 传入 desktopOnly:false 可附移动视口，但移动视口不参与门禁判定（仅诊断信息）。
 */
export async function renderCheck(opts) {
  const {
    wsDir = null, url = null, label = 'page', outDir,
    desktopOnly = true,
    viewports = desktopOnly
      ? [{ name: 'desktop', w: 1440, h: 900 }]
      : [{ name: 'desktop', w: 1440, h: 900 }, { name: 'mobile', w: 390, h: 844 }],
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

  // 精确视口：CDP Emulation.setDeviceMetricsOverride（--window-size 会被浏览器最小宽度钳制，见 cdp-viewport.mjs 注释）
  let cdp = null;
  try {
    if (!fs.existsSync(edgeBin())) {
      report.gate = { pass: false, status: 'not_run', reason: `渲染环境不可用：未找到浏览器 ${edgeBin()}` };
      fs.writeFileSync(path.join(outDir, `${label}-rendercheck.json`), JSON.stringify(report, null, 1));
      return report;
    }
    try {
      cdp = await launchCdp({ edgeBin: edgeBin(), timeoutMs });
    } catch (e) {
      report.gate = { pass: false, status: 'not_run', reason: `渲染环境不可用：CDP 启动失败（${String(e.message ?? e).slice(0, 100)}）` };
      fs.writeFileSync(path.join(outDir, `${label}-rendercheck.json`), JSON.stringify(report, null, 1));
      return report;
    }

    for (const vp of viewports) {
      const isMobile = vp.name === 'mobile' || vp.w <= 600;
      const t0 = performance.now();
      const cap = await captureAtViewport(cdp, {
        url: base, width: vp.w, height: vp.h, mobile: isMobile, waitMs: 1600,
      });

      if (!cap.ok) {
        report.viewports.push({
          viewport: vp, base,
          screenshot: { status: 'fail', reason: cap.error ?? '截图失败' },
          probe: { status: 'fail', reason: cap.error ?? '探针失败' },
          images: { status: 'skipped', reason: '页面未加载' },
          overflow: { status: 'skipped', reason: '页面未加载' },
          viewportMatch: { status: 'skipped' },
        });
        continue;
      }

      // 落盘截图
      const shotFile = `${label}-${vp.name}.png`;
      fs.writeFileSync(path.join(outDir, shotFile), cap.shot);
      const screenshot = { status: 'ok', file: shotFile, bytes: cap.shot.length, ms: Math.round(performance.now() - t0) };

      const m = cap.metrics;
      // 视口一致性断言（关键回归）：目标宽 vs 实际布局宽（容忍滚动条 ≤ 20px）+ 截图宽度必须等于目标宽
      const vpDelta = Math.abs(m.clientW - vp.w);
      const tolerance = isMobile ? 1 : 20;   // 桌面可能有 15px 滚动条
      const viewportOk = vpDelta <= tolerance;
      const shotOk = cap.shotW === vp.w;
      const viewportMatch = viewportOk && shotOk
        ? { status: 'ok', targetW: vp.w, clientW: m.clientW, shotW: cap.shotW, delta: vpDelta }
        : {
            status: 'fail',
            targetW: vp.w, clientW: m.clientW, shotW: cap.shotW, delta: vpDelta,
            reason: !viewportOk
              ? `实际布局视口 ${m.clientW}px 与目标 ${vp.w}px 偏差 ${vpDelta}px（视口模拟失真，检测结果不可信）`
              : `截图宽 ${cap.shotW}px ≠ 目标 ${vp.w}px`,
          };

      const probe = { status: 'ok', metrics: m };
      const images = (m.required ?? 0) === 0
        ? { status: 'ok', note: '页面无必需图片', required: 0, requiredFailed: 0 }
        : ((m.requiredFailed ?? 0) > 0
          ? { status: 'fail', required: m.required, requiredFailed: m.requiredFailed, note: '首屏必需图片未加载（懒加载图不计入）' }
          : { status: 'ok', required: m.required, requiredFailed: 0, lazy: m.lazy, lazyFailed: m.lazyFailed });

      // 横向溢出：同时用 scrollW>clientW 与「有元素右边缘超出布局视口」两条独立判据
      const overflowFail = m.overflowX || m.clippedCount > 0;
      const overflow = overflowFail
        ? {
            status: 'fail', scrollW: m.scrollW, clientW: m.clientW,
            clippedCount: m.clippedCount, clippedSample: m.clippedSample,
            note: m.overflowX ? '页面存在横向溢出' : `有 ${m.clippedCount} 个元素超出布局视口（被裁切）`,
          }
        : { status: 'ok', scrollW: m.scrollW, clientW: m.clientW, clippedCount: 0 };

      report.viewports.push({
        viewport: vp, base, screenshot, probe, images, overflow, viewportMatch,
        metaViewport: m.metaViewport, h1: m.h1, buttons: m.buttons,
        engine: 'cdp-emulation',
      });
    }
  } finally {
    if (cdp) await cdp.close();
    if (server) server.close();
  }

  // 门禁合成：只由桌面视口决定（内测版仅支持桌面网页）。
  // 若调用方额外传入移动视口，其结果记为诊断信息，不参与阻断。
  const v = report.viewports;
  const blocking = v.filter((x) => x.viewport.name === 'desktop');
  for (const x of v) {
    if (x.viewport.name !== 'desktop') x.blocking = false; // 非桌面视口：仅诊断
  }
  const anyFail = blocking.some((x) => x.screenshot?.status === 'fail' || x.images?.status === 'fail'
    || x.overflow?.status === 'fail' || x.probe?.status === 'fail' || x.viewportMatch?.status === 'fail');
  const allSkipped = blocking.length > 0 && blocking.every((x) => x.screenshot?.status !== 'ok' && x.probe?.status !== 'ok');
  report.gate = anyFail
    ? {
        pass: false, status: 'fail',
        reason: '存在桌面渲染缺陷（截图失败/必需图片未加载/横向溢出/视口失真/探针失效）',
      }
    : allSkipped
      ? { pass: false, status: 'not_run', reason: '渲染环境不可用（浏览器缺失或未注入探针），本轮未执行——不判通过' }
      : { pass: true, status: 'pass', reason: '桌面渲染通过：精确视口截图 + 首屏必需图片全部加载 + 无横向溢出/元素裁切（不构成视觉质量结论）' };
  fs.writeFileSync(path.join(outDir, `${label}-rendercheck.json`), JSON.stringify(report, null, 1));
  return report;
}
