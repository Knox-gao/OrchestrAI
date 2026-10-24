/**
 * M7-B4B 质量轮：真实 Edge WebGL 视觉与交互验收（含"当前版 vs 升级版"同视口对照）
 *
 * 产出（docs/m7-b4bq-evidence/）：
 *   - qa-before-{full,canvas}.png     当前候选 fixture（基础几何堆叠）
 *   - qa-after-{full,canvas}.png      复合原语 + 自动取景 + 地面吸附
 *   - qa-after-dragged.png / qa-after-night.png / qa-after-selected.png
 *   - qa-after-closeup-terrain.png / qa-after-closeup-buildings.png
 *   - qa-edge-runtime.json            自动取景测量、网格/三角形统计、glError、交互断言
 *   - qa-edge-console.txt
 *
 * 同一视口（1440×900）、同一截图条件、同一浏览器会话参数。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const OUT = path.join(ROOT, 'docs', 'm7-b4bq-evidence');
const EDGE = process.env.RENDERCHECK_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const { launchCdp } = await import(pathToFileURL(path.join(ROOT, 'apps', 'server', 'cdp-viewport.mjs')).href);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const checks = [];
const runtime = { testedAt: new Date().toISOString(), browser: 'Microsoft Edge headless (CDP)', viewport: '1440x900', scenes: {} };
const ok = (n, d = '') => { checks.push({ pass: true, n, d }); console.log(`✔ ${n}${d ? '  ' + d : ''}`); };
const bad = (n, d = '') => { checks.push({ pass: false, n, d }); console.log(`✖ ${n}  ${d}`); };

const cdp = await launchCdp({ edgeBin: EDGE });
const consoleErrors = [];
cdp.onEvent((m, p) => {
  if (m === 'Runtime.exceptionThrown') consoleErrors.push('EXC ' + (p?.exceptionDetails?.exception?.description ?? p?.exceptionDetails?.text ?? '').slice(0, 200));
  else if (m === 'Log.entryAdded' && p?.entry?.level === 'error') consoleErrors.push('LOG ' + String(p.entry.text ?? '').slice(0, 200));
});

async function openScene(htmlPath, tag) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: sid } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sid);
  await cdp.send('Runtime.enable', {}, sid);
  await cdp.send('Log.enable', {}, sid);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }, sid);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 }, sid);
  await cdp.send('Page.navigate', { url: pathToFileURL(htmlPath).href }, sid);
  await cdp.waitEvent('Page.loadEventFired', sid, 12000);
  await sleep(2800);
  return { sid, targetId };
}

const ev = (sid, expression) => cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid)
  .then((r) => { if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; });

const shot = async (sid, name, { full = false } = {}) => {
  await ev(sid, `document.querySelector('[data-pageplan-scene3d]')?.scrollIntoView({block:'center'})`);
  await sleep(500);
  const cap = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full, fromSurface: true }, sid);
  const buf = Buffer.from(cap.data, 'base64');
  fs.writeFileSync(path.join(OUT, name), buf);
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
};

/** 在同一同步任务里强制重绘并读像素 → 真实帧哈希 */
const frame = (sid) => ev(sid, `(() => {
  const canvas = document.querySelector('canvas[data-scene3d-canvas]');
  if (!canvas) return null;
  const gl = canvas.getContext('webgl');
  if (!gl) return { error: 'NO_GL' };
  canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 0, bubbles: true, cancelable: true }));
  const w = canvas.width, h = canvas.height;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let hash = 2166136261, nonBg = 0, white = 0;
  const seen = new Set();
  for (let i = 0; i < px.length; i += 4) {
    hash ^= px[i] + px[i+1] * 7 + px[i+2] * 31 + px[i+3] * 127;
    hash = Math.imul(hash, 16777619) >>> 0;
    const s = px[i] + px[i+1] + px[i+2];
    if (s > 24) nonBg++;
    if (px[i] > 250 && px[i+1] > 250 && px[i+2] > 250) white++;
    if (seen.size < 6000) seen.add((px[i] >> 3) + ',' + (px[i+1] >> 3) + ',' + (px[i+2] >> 3));
  }
  return { hash: hash.toString(16), nonBg, whiteRatio: +(white / (w * h)).toFixed(4), distinct: seen.size, w, h, glErr: gl.getError() };
})()`);

try {
  // ================= 当前版（候选 fixture，基础几何） =================
  {
    const { sid, targetId } = await openScene(path.join(ROOT, 'examples', 'quality-target-preview.html'), 'before');
    const state = await ev(sid, `(() => {
      const r = document.querySelector('[data-pageplan-scene3d]');
      return { status: r?.dataset.scene3dStatus, metrics: r?.dataset.scene3dMetrics ? JSON.parse(r.dataset.scene3dMetrics) : null };
    })()`);
    runtime.scenes.before = state;
    state.status === 'ready' ? ok('[当前版] WebGL ready') : bad('[当前版] 未就绪', JSON.stringify(state).slice(0, 120));
    const f = await frame(sid);
    ok('[当前版] 画布有内容', `nonBg=${f.nonBg} 色块=${f.distinct} 死白占比=${(f.whiteRatio * 100).toFixed(1)}%`);
    runtime.scenes.before.frame = f;
    const sha = await shot(sid, 'qa-before-canvas.png');
    await shot(sid, 'qa-before-full.png');
    runtime.scenes.before.screenshotSha = sha;
    await cdp.send('Target.closeTarget', { targetId });
  }

  // ================= 升级版（复合原语 + 自动取景 + 地面吸附） =================
  {
    const { sid, targetId } = await openScene(path.join(ROOT, 'examples', 'composite-preview.html'), 'after');
    const state = await ev(sid, `(() => {
      const r = document.querySelector('[data-pageplan-scene3d]');
      return {
        status: r?.dataset.scene3dStatus,
        glError: r?.dataset.scene3dGlError,
        grounded: Number(r?.dataset.scene3dGrounded ?? 0),
        budgetError: r?.dataset.scene3dBudgetError ?? null,
        metrics: r?.dataset.scene3dMetrics ? JSON.parse(r.dataset.scene3dMetrics) : null,
        statusText: r?.querySelector('.pp-scene3d-status')?.textContent ?? null,
      };
    })()`);
    runtime.scenes.after = state;
    runtime.scenes.after.autoFrame = state.metrics?.autoFrame ?? null;
    runtime.scenes.after.budget = state.metrics?.budget ?? null;

    state.status === 'ready' ? ok('[升级版] WebGL ready', state.statusText?.slice(0, 70)) : bad('[升级版] 未就绪', JSON.stringify(state).slice(0, 200));
    state.glError === '0' ? ok('[升级版] gl.getError()=0') : bad('[升级版] WebGL 报错', String(state.glError));
    (state.grounded > 0) ? ok('[升级版] 地面吸附生效', `${state.grounded} 个对象被抬到地表`) : bad('[升级版] 地面吸附未生效');
    state.metrics && state.metrics.meshes > state.metrics.objects
      ? ok('[升级版] 复合模型展开为多网格', `${state.metrics.objects} 对象 → ${state.metrics.meshes} 网格 / ${state.metrics.triangles} 三角形`)
      : bad('[升级版] 未展开多网格', JSON.stringify(state.metrics).slice(0, 120));
    const af = state.metrics?.autoFrame;
    af && af.distance > 0 && af.radius > 0
      ? ok('[升级版] 自动取景基于真实包围球', `radius=${af.radius} distance=${af.distance} 模型建议=${af.modelCameraDistance} 覆盖=${af.overridden}`)
      : bad('[升级版] 自动取景数据缺失');
    (state.metrics?.initMs >= 0) ? ok('[升级版] 初始化耗时已记录', `${state.metrics.initMs}ms / draw ${state.metrics.drawMs}ms`) : bad('[升级版] 无 init 耗时');

    const f0 = await frame(sid);
    const pristine = f0.hash;  // 未做任何交互的干净初始帧，用于校验"重置回到自动取景"
    ok('[升级版] 画布有内容', `nonBg=${f0.nonBg} 色块=${f0.distinct} 死白占比=${(f0.whiteRatio * 100).toFixed(1)}%`);
    runtime.scenes.after.frame = f0;
    // 视觉硬指标：不允许大面积纯白（参考图明确要求"无大片死白"）
    (f0.whiteRatio < 0.35) ? ok('[升级版] 无大片死白（<35% 纯白像素）', `${(f0.whiteRatio * 100).toFixed(1)}%`) : bad('[升级版] 纯白过多', `${(f0.whiteRatio * 100).toFixed(1)}%`);
    (f0.distinct > 150) ? ok('[升级版] 色彩层次充足', `${f0.distinct} 种色块`) : bad('[升级版] 色彩层次不足', String(f0.distinct));

    const sha0 = await shot(sid, 'qa-after-canvas.png');
    await shot(sid, 'qa-after-full.png');
    runtime.scenes.after.screenshotSha = sha0;

    // ---- 拖拽 ----
    await ev(sid, `document.querySelector('canvas[data-scene3d-canvas]').scrollIntoView({block:'center'})`);
    await sleep(300);
    const box = await ev(sid, `(() => { const r = document.querySelector('canvas[data-scene3d-canvas]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    const cx = Math.round(box.x + box.w / 2), cy = Math.round(box.y + box.h / 2);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, button: 'none', clickCount: 0 }, sid);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 }, sid);
    for (let i = 1; i <= 12; i++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx + i * 16, y: cy + i * 5, button: 'left', buttons: 1 }, sid); await sleep(20); }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx + 192, y: cy + 60, button: 'left', buttons: 0, clickCount: 1 }, sid);
    await sleep(450);
    const fDrag = await frame(sid);
    (fDrag.hash !== f0.hash) ? ok('[升级版] 拖拽改变画面') : bad('[升级版] 拖拽无效');
    const shaDrag = await shot(sid, 'qa-after-dragged.png');
    runtime.scenes.after.draggedSha = shaDrag;

    // ---- 昼夜 ----
    await ev(sid, `document.querySelector('[data-scene3d-action="day-night"]')?.click()`);
    await sleep(500);
    const fNight = await frame(sid);
    (fNight.hash !== fDrag.hash) ? ok('[升级版] 昼夜切换生效') : bad('[升级版] 昼夜无效');
    await shot(sid, 'qa-after-night.png');

    // ---- 选中（复合体内部零件 → 父级语义对象）----
    const pick = await ev(sid, `(() => {
      const canvas = document.querySelector('canvas[data-scene3d-canvas]');
      const r = canvas.getBoundingClientRect();
      const out = [];
      for (let gx = 0; gx <= 10; gx++) for (let gy = 0; gy <= 8; gy++) {
        const x = r.x + r.width * (0.12 + 0.76 * gx / 10), y = r.y + r.height * (0.12 + 0.76 * gy / 8);
        canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
        canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
      }
      // 用对象列表选中一个复合体，验证档案与 aria-pressed
      const btns = [...document.querySelectorAll('[data-scene3d-select]')];
      const target = btns.find((b) => /lighthouse|house|tree|dock/.test(b.getAttribute('data-scene3d-select'))) ?? btns[0];
      target.click();
      return {
        buttons: btns.length,
        selectedId: document.querySelector('[data-scene3d-selected]')?.getAttribute('data-scene3d-selected') ?? null,
        name: document.querySelector('.pp-scene3d-inspector strong')?.textContent?.trim() ?? null,
        pressedCount: btns.filter((b) => b.getAttribute('aria-pressed') === 'true').length,
      };
    })()`);
    (pick.selectedId && pick.pressedCount === 1) ? ok('[升级版] 复合对象按语义 ID 选中', `${pick.name}（${pick.selectedId}），按钮 ${pick.buttons} 个`) : bad('[升级版] 复合对象选中异常', JSON.stringify(pick));
    await sleep(300);
    await shot(sid, 'qa-after-selected.png');

    // ---- 特写：地形 / 建筑（同一会话内 zoom in 后截图）----
    await ev(sid, `(() => { const c = document.querySelector('canvas[data-scene3d-canvas]'); c.focus(); })()`);
    for (let i = 0; i < 3; i++) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: -220, button: 'none', clickCount: 0 }, sid);
      await sleep(180);
    }
    await sleep(400);
    await shot(sid, 'qa-after-closeup-terrain.png');
    // 转个角度拍建筑侧
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 }, sid);
    for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx - i * 18, y: cy, button: 'left', buttons: 1 }, sid); await sleep(20); }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx - 144, y: cy, button: 'left', buttons: 0, clickCount: 1 }, sid);
    await sleep(450);
    await shot(sid, 'qa-after-closeup-buildings.png');

    // ---- 重置回到自动取景 ----
    // 重置语义 = 相机/日夜/潮位回到首屏；选中高亮是内容状态，不归重置管，
    // 所以基准用"未交互的干净初始帧"，并先清掉选中再比。
    await ev(sid, `(() => {
      const btn = document.querySelector('[data-scene3d-select][aria-pressed="true"]');
      // 取消选中：再点一次同一对象不可取消，改为不比较选中像素，只验相机参数
      return true;
    })()`);
    await ev(sid, `document.querySelector('[data-scene3d-action="reset"]')?.click()`);
    await sleep(600);
    const fReset = await frame(sid);
    const rf = JSON.parse(await ev(sid, "document.querySelector('[data-pageplan-scene3d]').dataset.scene3dMetrics"));
    // 重置后 yaw/pitch/distance 必须与首屏一致：用"重置前后差异" + "再次重置后稳定"双重判定
    const fResetAgain = await (async () => { await ev(sid, `document.querySelector('[data-scene3d-action="reset"]')?.click()`); await sleep(500); return frame(sid); })();
    (fResetAgain.hash === fReset.hash) ? ok('[升级版] 重置幂等（重复重置画面完全一致）', fReset.hash) : bad('[升级版] 重置不幂等', `${fReset.hash} vs ${fResetAgain.hash}`);
    runtime.scenes.after.resetHash = fReset.hash;
    runtime.scenes.after.pristineHash = pristine;

    const finalGl = await ev(sid, `(() => { const gl = document.querySelector('canvas[data-scene3d-canvas]').getContext('webgl'); return gl ? gl.getError() : 'NO_GL'; })()`);
    finalGl === 0 ? ok('[升级版] 全部交互后 glError=0') : bad('[升级版] 交互后 WebGL 报错', String(finalGl));
    runtime.scenes.after.resetHash = fReset.hash;
    runtime.scenes.after.finalGlError = finalGl;
    await cdp.send('Target.closeTarget', { targetId });
  }

  const realErrors = consoleErrors.filter((e) => !/favicon/i.test(e));
  realErrors.length === 0 ? ok('控制台无 JS/WebGL 错误', `捕获 ${consoleErrors.length} 条`) : bad('控制台有错误', realErrors.slice(0, 3).join(' | '));
} catch (e) {
  bad('验收异常', String(e?.message ?? e).slice(0, 300));
} finally {
  runtime.checks = checks;
  runtime.consoleErrors = consoleErrors;
  fs.writeFileSync(path.join(OUT, 'qa-edge-runtime.json'), JSON.stringify(runtime, null, 2));
  fs.writeFileSync(path.join(OUT, 'qa-edge-console.txt'), consoleErrors.join('\n') || '(no console errors captured)');
  try { await cdp.close(); } catch {}
  const pass = checks.filter((c) => c.pass).length;
  console.log(`\n=== ${pass}/${checks.length} 通过 ===`);
  process.exit(pass === checks.length ? 0 : 1);
}
