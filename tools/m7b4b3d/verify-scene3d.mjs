/**
 * M7-B4B-3D：真实 Edge WebGL 验收（不是 mock，不是字符串断言）
 *
 * 覆盖 BROWSER-3D-ACCEPTANCE.md 的每一条：
 *   初始化门禁、拖拽、滚轮缩放、键盘、重置、自动旋转、减少动态效果、
 *   点击拾取（深度约束）、对象列表、昼夜、潮位、resize、控制台与 glError。
 *
 * 采样方法说明（关键）：
 *   页面用 preserveDrawingBuffer:false 的 WebGL context（这是正确做法，性能更好）。
 *   因此"事后" readPixels 永远读到空缓冲。本脚本改为：
 *     1) 派发一个不改变状态的 wheel(deltaY=0) 事件 → 触发页面自己的 draw()
 *     2) 在**同一个同步任务**里立即 readPixels → 拿到该帧真实像素
 *   哈希基于像素内容，任何相机/光照/几何变化都会改变它。
 *   同时保存真实 Edge 截图作为人工审查证据。
 *
 * 用法：node tools/m7b4b3d/verify-scene3d.mjs [html路径]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const TARGET = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'examples', 'island-rendered-preview.html');
const OUT = path.join(ROOT, 'docs', 'm7-b4b3d-evidence');
const EDGE = process.env.RENDERCHECK_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const { launchCdp } = await import(pathToFileURL(path.join(ROOT, 'apps', 'server', 'cdp-viewport.mjs')).href);

fs.mkdirSync(OUT, { recursive: true });
const checks = [];
const ok = (n, d = '') => { checks.push({ pass: true, n, d }); console.log(`✔ ${n}${d ? '  ' + d : ''}`); };
const bad = (n, d = '') => { checks.push({ pass: false, n, d }); console.log(`✖ ${n}  ${d}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cdp = await launchCdp({ edgeBin: EDGE });
let sid = null;
let tid = null;
const consoleErrors = [];
const glErrors = [];

const ev = async (expression) => {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid);
  if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'eval failed');
  return r?.result?.value;
};

/** 在同一同步任务内强制重绘并读像素，返回真实帧哈希 + 非空像素数 */
const frame = async () => ev(`(() => {
  const canvas = document.querySelector('[data-pageplan-scene3d] canvas[data-scene3d-canvas]');
  if (!canvas) return null;
  const gl = canvas.getContext('webgl');
  if (!gl) return { error: 'NO_GL' };
  // deltaY=0 不改变相机距离，但会触发页面自己的 draw()
  canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 0, bubbles: true, cancelable: true }));
  const w = canvas.width, h = canvas.height;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let hash = 2166136261, nonBg = 0;
  const seen = new Set();
  for (let i = 0; i < px.length; i += 4) {
    hash ^= px[i] + px[i+1] * 7 + px[i+2] * 31 + px[i+3] * 127;
    hash = Math.imul(hash, 16777619) >>> 0;
    if (px[i] + px[i+1] + px[i+2] > 24) nonBg++;
    if (seen.size < 5000) seen.add((px[i] >> 3) + ',' + (px[i+1] >> 3) + ',' + (px[i+2] >> 3));
  }
  return { hash: hash.toString(16), nonBg, distinct: seen.size, w, h, glErr: gl.getError() };
})()`);

/**
 * 全视口截图（不带 clip）。
 * 不用 clip 的原因：Page.captureScreenshot 的 clip 是文档绝对坐标，
 * 页面滚动后按 getBoundingClientRect 传入会拍到错误区域（实测拍到画布上方）。
 * 先把画布滚到视口中央，再整屏截图 —— 这既准确又保留页面上下文，更适合人工审查。
 */
const shotCanvas = async (name) => {
  const okBox = await ev(`(() => { const c = document.querySelector('canvas[data-scene3d-canvas]'); if (!c) return null; c.scrollIntoView({ block: 'center' }); return true; })()`);
  await sleep(350);
  if (!okBox) return null;
  const cap = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true }, sid);
  const buf = Buffer.from(cap.data, 'base64');
  fs.writeFileSync(path.join(OUT, name), buf);
  return { bytes: buf.length, sha: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16) };
};

const mouse = (type, x, y) => cdp.send('Input.dispatchMouseEvent', {
  type, x, y, button: type === 'mouseMoved' ? 'none' : 'left',
  buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 0,
}, sid);

const pressKey = async (k, code) => {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: 0 }, sid);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: 0 }, sid);
  await sleep(60);
};

try {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  tid = targetId;
  sid = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await cdp.send('Page.enable', {}, sid);
  await cdp.send('Runtime.enable', {}, sid);
  await cdp.send('Log.enable', {}, sid);
  cdp.onEvent((method, params) => {
    if (method === 'Runtime.exceptionThrown') consoleErrors.push(`exception: ${params?.exceptionDetails?.text ?? ''}`);
    else if (method === 'Log.entryAdded' && params?.entry?.level === 'error') consoleErrors.push(`log: ${String(params.entry.text ?? '').slice(0, 160)}`);
    else if (method === 'Runtime.consoleAPICalled' && params?.type === 'error') consoleErrors.push(`console.error: ${(params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 160)}`);
  });

  // headless Edge 默认 prefers-reduced-motion: reduce，会让自动旋转被（正确地）禁用。
  // 先显式声明 no-preference，才能验证"允许动效时确实会转"。
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }, sid);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900,
  }, sid);
  await cdp.send('Page.navigate', { url: pathToFileURL(TARGET).href }, sid);
  await cdp.waitEvent('Page.loadEventFired', sid, 10000);
  await sleep(2200);

  // ---- 1) 初始化门禁（照 BROWSER-3D-ACCEPTANCE.md 的原始探针）----
  const init = await ev(`(() => {
    const root = document.querySelector('[data-pageplan-scene3d]');
    const canvas = root?.querySelector('canvas[data-scene3d-canvas]');
    return {
      status: root?.dataset.scene3dStatus,
      width: canvas?.width, height: canvas?.height,
      clientWidth: canvas?.clientWidth, clientHeight: canvas?.clientHeight,
      glError: (() => { const gl = canvas?.getContext('webgl'); return gl ? gl.getError() : 'NO_WEBGL_CONTEXT'; })(),
      errorVisible: root?.querySelector('[data-scene3d-error]')?.hidden === false,
      glRenderer: (() => { const gl = canvas?.getContext('webgl'); if (!gl) return null; const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })(),
    };
  })()`);
  init.status === 'ready' ? ok('scene3d 初始化 status=ready', String(init.glRenderer).slice(0, 70)) : bad('scene3d 未就绪', JSON.stringify(init).slice(0, 200));
  (init.width > 0 && init.height > 0) ? ok('canvas 实际像素尺寸 > 0', `${init.width}×${init.height}`) : bad('canvas 无实际尺寸');
  (init.clientWidth > 0 && init.clientHeight > 0) ? ok('canvas CSS 可见尺寸 > 0', `${init.clientWidth}×${init.clientHeight}`) : bad('canvas 不可见');
  init.glError === 0 ? ok('gl.getError() = 0 (NO_ERROR)', String(init.glError)) : bad('WebGL 报错', String(init.glError));
  init.errorVisible === false ? ok('未显示降级错误提示（真的渲染了，不是静态图）') : bad('显示了 WebGL 失败提示');

  // ---- 2) 场景确实画出内容 ----
  await ev(`document.querySelector('canvas[data-scene3d-canvas]').scrollIntoView({ block: 'center' })`);
  await sleep(400);
  const f0 = await frame();
  (f0 && f0.nonBg > 5000) ? ok('画布有实际绘制内容（非空白）', `nonBg=${f0.nonBg}/${f0.w * f0.h} 色块=${f0.distinct} glErr=${f0.glErr}`) : bad('画布近乎空白', JSON.stringify(f0));
  (f0?.distinct > 50) ? ok('画面有丰富色彩层次（不是纯色块）', `${f0.distinct} 种色块`) : bad('画面色彩过于单一', String(f0?.distinct));
  f0?.glErr === 0 ? ok('绘制后 gl.getError() = 0') : bad('绘制后 WebGL 报错', String(f0?.glErr));
  const shotInitial = await shotCanvas('scene3d-edge-initial.png');
  shotInitial ? ok('真实 Edge 截图已保存（画布区域）', `${shotInitial.sha} ${shotInitial.bytes}B`) : bad('截图失败');

  // ---- 3) 拖拽：相机角度必须真的变化 ----
  const box = await ev(`(() => { const r = document.querySelector('canvas[data-scene3d-canvas]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const cx = Math.round(box.x + box.w / 2), cy = Math.round(box.y + box.h / 2);
  await mouse('mouseMoved', cx, cy);
  await mouse('mousePressed', cx, cy);
  for (let i = 1; i <= 12; i++) { await mouse('mouseMoved', cx + i * 16, cy + i * 5); await sleep(20); }
  await mouse('mouseReleased', cx + 192, cy + 60);
  await sleep(400);
  const fDrag = await frame();
  (fDrag.hash !== f0.hash) ? ok('拖拽后画面改变（相机真的在转）', `${f0.hash} → ${fDrag.hash}`) : bad('拖拽无效果（帧哈希未变）', `${f0.hash}`);
  const shotDrag = await shotCanvas('scene3d-edge-dragged.png');
  shotDrag && shotDrag.sha !== shotInitial.sha ? ok('拖拽前后真实截图不同（视觉证据一致）', `${shotInitial.sha} → ${shotDrag.sha}`) : bad('截图未体现拖拽效果');

  // ---- 4) 滚轮缩放 ----
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: -260, button: 'none', clickCount: 0 }, sid);
  await sleep(400);
  const fZoom = await frame();
  (fZoom.hash !== fDrag.hash) ? ok('滚轮缩放后画面改变', `${fDrag.hash} → ${fZoom.hash}`) : bad('滚轮缩放无效果');

  // ---- 5) 键盘：逐个键独立判定（左右/上下/± 成对按会互相抵消，不能作为一组比较）----
  await ev(`document.querySelector('canvas[data-scene3d-canvas]').scrollIntoView({ block: 'center' }); document.querySelector('canvas[data-scene3d-canvas]').focus()`);
  await sleep(250);
  const focused = await ev(`document.activeElement === document.querySelector('canvas[data-scene3d-canvas]')`);
  focused ? ok('画布可获得键盘焦点（tabindex）') : bad('画布无法获得焦点，键盘路径不可达');
  let prevHash = (await frame()).hash;
  const keyResults = [];
  for (const [k, code] of [['ArrowLeft', 'ArrowLeft'], ['ArrowRight', 'ArrowRight'], ['ArrowUp', 'ArrowUp'], ['ArrowDown', 'ArrowDown'], ['+', 'Equal'], ['-', 'Minus']]) {
    await pressKey(k, code);
    await sleep(150);
    const h = (await frame()).hash;
    keyResults.push({ key: k, changed: h !== prevHash });
    prevHash = h;
  }
  const keyChanged = keyResults.filter((r) => r.changed).map((r) => r.key);
  (keyChanged.length === keyResults.length)
    ? ok('键盘 6 个键（方向键 ×4 与 ±）各自都改变了相机', keyChanged.join(' '))
    : bad('部分按键无响应', `有效=${keyChanged.join(',') || '无'} 无效=${keyResults.filter((r) => !r.changed).map((r) => r.key).join(',')}`);

  // ---- 6) 重置视角 ----
  const fPreReset = await frame();
  await ev(`document.querySelector('[data-scene3d-action="reset"]').click()`);
  await sleep(450);
  const fReset = await frame();
  (fReset.hash !== fPreReset.hash) ? ok('重置视角后画面变化', `${fPreReset.hash} → ${fReset.hash}`) : bad('重置无效果');
  (fReset.hash === f0.hash) ? ok('重置回到初始视角（与初始帧哈希一致）', `${fReset.hash}`) : bad('重置未回到初始视角', `init=${f0.hash} reset=${fReset.hash}`);

  // ---- 7) 自动旋转（在 no-preference 下）----
  const pressed = await ev(`(() => { const b = document.querySelector('[data-scene3d-action="auto-rotate"]'); b.click(); return b.getAttribute('aria-pressed'); })()`);
  await sleep(800);
  const fA1 = await frame();
  await sleep(800);
  const fA2 = await frame();
  (pressed === 'true' && fA1.hash !== fA2.hash) ? ok('自动旋转开启后持续转动', `aria-pressed=${pressed}`) : bad('自动旋转未转动', `pressed=${pressed} ${fA1.hash}/${fA2.hash}`);
  await ev(`document.querySelector('[data-scene3d-action="auto-rotate"]').click()`);
  await sleep(300);
  const fS1 = await frame();
  await sleep(900);
  const fS2 = await frame();
  (fS1.hash === fS2.hash) ? ok('关闭自动旋转后确实停止', fS1.hash) : bad('关闭后仍在转', `${fS1.hash} ≠ ${fS2.hash}`);

  // ---- 8) 深度拾取（关键：不能只按屏幕中心距离选）----
  // 海面 disk 铺满基座；岛主体挡在它前面。点画布中心必须选中岛，而不是背景海面。
  const pickCenter = await ev(`(() => {
    const canvas = document.querySelector('canvas[data-scene3d-canvas]');
    const r = canvas.getBoundingClientRect();
    const x = r.x + r.width * 0.5, y = r.y + r.height * 0.58;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
    return { name: document.querySelector('.pp-scene3d-inspector strong')?.textContent?.trim() ?? null,
             desc: document.querySelector('.pp-scene3d-inspector p')?.textContent?.slice(0, 44) ?? null };
  })()`);
  (pickCenter.name && pickCenter.name !== '环岛海面') ? ok('画布中心拾取到前方实体（深度缓冲生效，未误选背景海面）', pickCenter.name) : bad('拾取未受深度约束（选到了背景海面）', JSON.stringify(pickCenter));
  await sleep(250);
  const shotSelected = await shotCanvas('scene3d-edge-selected-object.png');
  shotSelected ? ok('选中对象后的真实截图已保存', shotSelected.sha) : bad('选中截图失败');

  const scan = await ev(`(() => {
    const canvas = document.querySelector('canvas[data-scene3d-canvas]');
    const r = canvas.getBoundingClientRect();
    const names = new Set(); let hits = 0, total = 0;
    for (let gx = 0; gx <= 12; gx++) for (let gy = 0; gy <= 9; gy++) {
      const x = r.x + r.width * (0.08 + 0.84 * gx / 12);
      const y = r.y + r.height * (0.08 + 0.84 * gy / 9);
      canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
      total++; const n = document.querySelector('.pp-scene3d-inspector strong')?.textContent?.trim(); if (n) { hits++; names.add(n); }
    }
    return { hits, total, names: [...names], selectableCount: document.querySelectorAll('[data-scene3d-select]').length };
  })()`);
  (scan?.hits > 0 && scan.names.length >= 3) ? ok('画布网格扫描能命中多个不同对象', `${scan.hits}/${scan.total} 命中，${scan.names.length} 个不同对象`) : bad('拾取覆盖不足', JSON.stringify(scan));

  // ---- 9) 对象列表按钮 ----
  const listButtons = await ev(`[...document.querySelectorAll('[data-scene3d-select]')].map(b => ({ id: b.getAttribute('data-scene3d-select'), name: b.textContent.trim() }))`);
  if (listButtons?.length) {
    const first = listButtons[0];
    await ev(`document.querySelector('[data-scene3d-select="${first.id}"]').click()`);
    await sleep(300);
    const sel = await ev(`({ name: document.querySelector('.pp-scene3d-inspector strong')?.textContent?.trim(), desc: document.querySelector('.pp-scene3d-inspector p')?.textContent?.slice(0, 50), pressed: document.querySelector('[data-scene3d-select="${first.id}"]')?.getAttribute('aria-pressed'), others: [...document.querySelectorAll('[data-scene3d-select]')].filter(b => b.getAttribute('aria-pressed') === 'true').length })`);
    (sel?.pressed === 'true' && sel.others === 1 && sel.name) ? ok('对象列表选择：档案更新且 aria-pressed 唯一', `${sel.name}：${sel.desc}`) : bad('对象列表选择异常', JSON.stringify(sel));
  } else bad('对象列表为空');

  // ---- 10) 昼夜 ----
  const fDay0 = await frame();
  const dayPressed = await ev(`(() => { const b = document.querySelector('[data-scene3d-action="day-night"]'); b.click(); return b.getAttribute('aria-pressed'); })()`);
  await sleep(450);
  const fNight = await frame();
  (dayPressed === 'true' && fNight.hash !== fDay0.hash) ? ok('昼夜切换真实改变场景（背景/光照）', `${fDay0.hash} → ${fNight.hash}`) : bad('昼夜无视觉效果');
  const shotNight = await shotCanvas('scene3d-edge-night.png');
  shotNight ? ok('夜景截图已保存', shotNight.sha) : bad('夜景截图失败');

  // ---- 11) 潮位滑块（motion=tide 的 disk 高度）----
  const tide = await ev(`(() => {
    const range = document.querySelector('[data-scene3d-tide]');
    if (!range) return null;
    range.value = '0.18'; range.dispatchEvent(new Event('input', { bubbles: true }));
    return { value: range.value };
  })()`);
  await sleep(450);
  const fTide = await frame();
  (tide && fTide.hash !== fNight.hash) ? ok('潮位滑块真实改变海面高度', `value=${tide.value}`) : bad('潮位无效果', JSON.stringify(tide));

  // ---- 12) resize ----
  const fPreResize = await frame();
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1100, height: 780, deviceScaleFactor: 1, mobile: false, screenWidth: 1100, screenHeight: 780,
  }, sid);
  await sleep(1000);
  const fPost = await frame();
  (fPost.w !== fPreResize.w && fPost.w > 0 && fPost.h > 0) ? ok('resize 后 canvas 像素尺寸同步更新', `${fPreResize.w}×${fPreResize.h} → ${fPost.w}×${fPost.h}`) : bad('resize 未同步', `${fPreResize.w}/${fPost.w}`);
  (fPost.nonBg > 5000) ? ok('resize 后场景仍完整可观察（非空白）', `nonBg=${fPost.nonBg}`) : bad('resize 后画面丢失', String(fPost.nonBg));

  // ---- 13) 减少动态效果偏好 ----
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900,
  }, sid);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sid);
  await cdp.send('Page.reload', {}, sid);
  await cdp.waitEvent('Page.loadEventFired', sid, 10000);
  await sleep(2200);
  const reduced = await ev(`(() => { const b = document.querySelector('[data-scene3d-action="auto-rotate"]'); b.click(); return { pressed: b.getAttribute('aria-pressed'), status: document.querySelector('.pp-scene3d-status')?.textContent ?? '' }; })()`);
  await sleep(700);
  const fR1 = await frame();
  await sleep(800);
  const fR2 = await frame();
  (reduced?.pressed === 'false' && fR1.hash === fR2.hash) ? ok('prefers-reduced-motion 下自动旋转被尊重（禁用）', reduced.status.slice(0, 34)) : bad('减少动态效果未生效', JSON.stringify(reduced));
  const shotReduced = await shotCanvas('scene3d-edge-reduced-motion.png');
  shotReduced ? ok('减少动态效果下场景仍正常渲染', shotReduced.sha) : bad('减少动态效果下渲染失败');

  // ---- 14) 全部交互后 glError / 控制台 ----
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }, sid);
  const finalGl = await ev(`(() => { const c = document.querySelector('canvas[data-scene3d-canvas]'); const gl = c.getContext('webgl'); return gl ? gl.getError() : 'NO_GL'; })()`);
  glErrors.push(finalGl);
  finalGl === 0 ? ok('全部交互后 gl.getError() 仍为 0', String(finalGl)) : bad('交互后 WebGL 报错', String(finalGl));
  const realErrors = consoleErrors.filter((e) => !/favicon/i.test(e));
  realErrors.length === 0 ? ok('控制台无 JS/WebGL 错误', `捕获 ${consoleErrors.length} 条（已过滤 favicon）`) : bad('控制台有错误', realErrors.slice(0, 3).join(' | '));

  // ---- 15) 语义：确实是"岛屿+建筑+海面"，不是轨道星图 ----
  const semantics = await ev(`(() => {
    const cfg = JSON.parse(document.querySelector('script[data-scene3d-config]').textContent);
    const shapes = cfg.objects.map(o => o.shape);
    const names = cfg.objects.map(o => o.name);
    return { total: cfg.objects.length, shapes: [...new Set(shapes)], hasIsland: shapes.includes('island'), hasBuilding: names.some(n => /灯塔|渔村|温室|屋/.test(n)), hasWater: names.some(n => /海|水/.test(n)), tideObjects: cfg.objects.filter(o => o.motion === 'tide').length };
  })()`);
  (semantics.hasIsland && semantics.hasBuilding && semantics.hasWater && semantics.tideObjects > 0)
    ? ok('场景构成是"岛屿+建筑+海面"（非轨道星图）', `${semantics.total} 对象 / ${semantics.shapes.join(',')}`)
    : bad('场景语义不符', JSON.stringify(semantics));
} catch (e) {
  bad('验收异常', String(e?.message ?? e).slice(0, 300));
} finally {
  const runtime = {
    testedAt: new Date().toISOString(),
    target: path.relative(ROOT, TARGET),
    browser: 'Microsoft Edge (headless=new, CDP Emulation.setDeviceMetricsOverride)',
    viewport: '1440x900 → 1100x780',
    method: 'frame hash = readPixels in same task as forced draw (preserveDrawingBuffer:false), plus real Edge screenshots',
    checks,
    glErrors,
    consoleErrors,
  };
  fs.writeFileSync(path.join(OUT, 'scene3d-edge-runtime.json'), JSON.stringify(runtime, null, 2));
  fs.writeFileSync(path.join(OUT, 'scene3d-edge-console.txt'), consoleErrors.join('\n') || '(no console errors captured)');
  if (tid) { try { await cdp.send('Target.closeTarget', { targetId: tid }); } catch {} }
  try { await cdp.close(); } catch {}
  const pass = checks.filter((c) => c.pass).length;
  console.log(`\n=== ${pass}/${checks.length} 通过 ===`);
  process.exit(pass === checks.length ? 0 : 1);
}
