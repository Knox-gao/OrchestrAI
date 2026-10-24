/**
 * 快速视觉对照截图：同一视口下渲染一个 PagePlan HTML，输出全视口 + 画布特写。
 * 用法：node tools/m7b4bq/shot.mjs <html> <outPrefix>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const HTML = path.resolve(process.argv[2]);
const PREFIX = process.argv[3] || 'shot';
const OUT = path.join(ROOT, 'docs', 'm7-b4bq-evidence');
const EDGE = process.env.RENDERCHECK_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const { launchCdp } = await import(pathToFileURL(path.join(ROOT, 'apps', 'server', 'cdp-viewport.mjs')).href);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(OUT, { recursive: true });
const cdp = await launchCdp({ edgeBin: EDGE });
let sid = null, tid = null;
const errs = [];
const ev = async (expression) => {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid);
  if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r?.result?.value;
};
const snap = async (name) => {
  const cap = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true }, sid);
  fs.writeFileSync(path.join(OUT, name), Buffer.from(cap.data, 'base64'));
  return name;
};
try {
  const t = await cdp.send('Target.createTarget', { url: 'about:blank' }); tid = t.targetId;
  sid = (await cdp.send('Target.attachToTarget', { targetId: tid, flatten: true })).sessionId;
  await cdp.send('Page.enable', {}, sid);
  await cdp.send('Runtime.enable', {}, sid);
  await cdp.send('Log.enable', {}, sid);
  cdp.onEvent((m, p) => {
    if (m === 'Runtime.exceptionThrown') errs.push('EXC ' + (p?.exceptionDetails?.text ?? '') + ' ' + (p?.exceptionDetails?.exception?.description ?? '').slice(0, 200));
    else if (m === 'Log.entryAdded' && p?.entry?.level === 'error') errs.push('LOG ' + String(p.entry.text ?? '').slice(0, 200));
  });
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }, sid);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 }, sid);
  await cdp.send('Page.navigate', { url: pathToFileURL(HTML).href }, sid);
  await cdp.waitEvent('Page.loadEventFired', sid, 12000);
  await sleep(3000);

  const state = await ev(`(() => {
    const root = document.querySelector('[data-pageplan-scene3d]');
    const c = root?.querySelector('canvas[data-scene3d-canvas]');
    return {
      status: root?.dataset.scene3dStatus ?? null,
      glError: root?.dataset.scene3dGlError ?? null,
      budgetError: root?.dataset.scene3dBudgetError ?? null,
      metrics: root?.dataset.scene3dMetrics ?? null,
      canvas: c ? { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight } : null,
      statusText: root?.querySelector('.pp-scene3d-status')?.textContent ?? null,
    };
  })()`);
  console.log(JSON.stringify(state, null, 1));

  await ev(`document.querySelector('[data-pageplan-scene3d]')?.scrollIntoView({block:'center'})`);
  await sleep(500);
  console.log('shot:', await snap(`${PREFIX}-full.png`));

  // 画布特写（页面内裁切 canvas 区域：用元素截图而非 clip 坐标）
  const box = await ev(`(() => { const c = document.querySelector('canvas[data-scene3d-canvas]'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  if (box) {
    const cap = await cdp.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true, fromSurface: true,
      clip: { x: box.x, y: box.y + (await ev('window.scrollY')), width: box.w, height: box.h, scale: 1 },
    }, sid);
    fs.writeFileSync(path.join(OUT, `${PREFIX}-canvas.png`), Buffer.from(cap.data, 'base64'));
    console.log('shot:', `${PREFIX}-canvas.png`);
  }
  console.log('errors:', JSON.stringify(errs.slice(0, 6), null, 1));
} finally {
  if (tid) { try { await cdp.send('Target.closeTarget', { targetId: tid }); } catch {} }
  try { await cdp.close(); } catch {}
}
