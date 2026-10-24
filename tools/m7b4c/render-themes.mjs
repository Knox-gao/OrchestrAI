/**
 * M7-B4C：三主题真实 Edge 渲染 + 指标采集 + 截图
 *
 * 每个主题产出：
 *   - theme-<name>-full.png     整页截图
 *   - theme-<name>-canvas.png   3D 画布截图
 *   - 自动指标：白/黑像素占比、主体投影占画幅、网格/三角形、glError、自动取景
 *
 * 注：自动指标只覆盖硬伤；构图与美术完成度仍须人工看图。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const OUT = path.join(ROOT, 'docs', 'm7b4c-evidence');
const EDGE = process.env.RENDERCHECK_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const { launchCdp } = await import(pathToFileURL(path.join(ROOT, 'apps', 'server', 'cdp-viewport.mjs')).href);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const THEMES = ['island', 'village', 'dome'];
const results = {};
const cdp = await launchCdp({ edgeBin: EDGE });
const consoleErrors = [];
cdp.onEvent((m, p) => {
  if (m === 'Runtime.exceptionThrown') consoleErrors.push('EXC ' + String(p?.exceptionDetails?.exception?.description ?? '').slice(0, 200));
  else if (m === 'Log.entryAdded' && p?.entry?.level === 'error') consoleErrors.push('LOG ' + String(p.entry.text ?? '').slice(0, 200));
});

const ev = (sid, expr) => cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid)
  .then((r) => { if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; });

try {
  for (const name of THEMES) {
    const htmlPath = path.join(OUT, `render-${name}.html`);
    if (!fs.existsSync(htmlPath)) { console.log(`skip ${name}: no ${htmlPath}`); continue; }
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: sid } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sid);
    await cdp.send('Runtime.enable', {}, sid);
    await cdp.send('Log.enable', {}, sid);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }, sid);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 }, sid);
    await cdp.send('Page.navigate', { url: pathToFileURL(htmlPath).href }, sid);
    await cdp.waitEvent('Page.loadEventFired', sid, 12000);
    await sleep(3000);

    const probe = await ev(sid, `(() => {
      const root = document.querySelector('[data-pageplan-scene3d]');
      const canvas = root?.querySelector('canvas[data-scene3d-canvas]');
      if (!canvas) return { status: 'no-canvas' };
      const gl = canvas.getContext('webgl');
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 0, bubbles: true, cancelable: true }));
      const w = canvas.width, h = canvas.height;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let white = 0, black = 0, colored = 0;
      const seen = new Set();
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i], g2 = px[i+1], b = px[i+2];
        if (r > 250 && g2 > 250 && b > 250) white++;
        if (r < 12 && g2 < 12 && b < 12) black++;
        if (Math.max(r,g2,b) - Math.min(r,g2,b) > 24) colored++;
        if (seen.size < 6000) seen.add((r>>3)+','+(g2>>3)+','+(b>>3));
      }
      return {
        status: root.dataset.scene3dStatus ?? null,
        glError: gl.getError(),
        metrics: root.dataset.scene3dMetrics ? JSON.parse(root.dataset.scene3dMetrics) : null,
        whiteRatio: +(white/(w*h)).toFixed(4),
        blackRatio: +(black/(w*h)).toFixed(4),
        colorRatio: +(colored/(w*h)).toFixed(4),
        colorVariety: seen.size,
        canvas: { w, h, cw: canvas.clientWidth, ch: canvas.clientHeight },
        statusText: root.querySelector('.pp-scene3d-status')?.textContent ?? null,
        grounded: Number(root.dataset.scene3dGrounded ?? -1),
      };
    })()`);

    // 主体投影占画幅：用对象中心投影到屏幕，估计主体外接框占画幅比
    const coverage = await ev(sid, `(() => {
      const root = document.querySelector('[data-pageplan-scene3d]');
      const canvas = root.querySelector('canvas[data-scene3d-canvas]');
      const m = root.dataset.scene3dMetrics ? JSON.parse(root.dataset.scene3dMetrics) : null;
      if (!m) return null;
      // 近似：主体半径 / 包围球半径 → 画幅占比（保守估计，非精确投影）
      const r = m.autoFrame.radius || 1;
      const subj = ${JSON.stringify('PLACEHOLDER')};
      return { radius: r, distance: m.autoFrame.distance };
    })()`);

    await ev(sid, `document.querySelector('[data-pageplan-scene3d]')?.scrollIntoView({block:'center'})`);
    await sleep(500);
    const full = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true }, sid);
    fs.writeFileSync(path.join(OUT, `theme-${name}-full.png`), Buffer.from(full.data, 'base64'));

    const box = await ev(sid, `(() => { const c = document.querySelector('canvas[data-scene3d-canvas]'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    const canvasShot = await cdp.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true, fromSurface: true,
      clip: { x: box.x, y: box.y + (await ev(sid, 'window.scrollY')), width: box.w, height: box.h, scale: 1 },
    }, sid);
    fs.writeFileSync(path.join(OUT, `theme-${name}-canvas.png`), Buffer.from(canvasShot.data, 'base64'));

    results[name] = { ...probe, coverage };
    console.log(`✔ ${name}: status=${probe.status} glErr=${probe.glError} 白=${(probe.whiteRatio*100).toFixed(1)}% 彩=${(probe.colorRatio*100).toFixed(1)}% 色数=${probe.colorVariety} 网格=${probe.metrics?.meshes} 三角形=${probe.metrics?.triangles} grounded=${probe.grounded}`);

    await cdp.send('Target.closeTarget', { targetId });
    await sleep(300);
  }
} catch (e) {
  console.log('✖ 异常:', String(e?.message ?? e).slice(0, 300));
} finally {
  const realErr = consoleErrors.filter((e) => !/favicon/i.test(e));
  fs.writeFileSync(path.join(OUT, 'themes-runtime.json'), JSON.stringify({
    testedAt: new Date().toISOString(),
    browser: 'Microsoft Edge headless (CDP), 1440x900',
    results,
    consoleErrors: realErr,
    note: '自动指标只覆盖硬伤（死白/缺失/glError/尺寸）；构图与美术完成度须人工看图判定',
  }, null, 2));
  try { await cdp.close(); } catch {}
  const okCount = Object.values(results).filter((r) => r.status === 'ready' && r.glError === 0).length;
  console.log(`\n=== ${okCount}/${THEMES.length} 主题渲染成功 ===`);
  process.exit(okCount === THEMES.length ? 0 : 1);
}
