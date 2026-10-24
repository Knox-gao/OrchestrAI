/**
 * M7-B4B-3D：ZIP 独立运行验收（真实交付流程导出 → 全新临时目录 → 真实 Edge WebGL）
 *
 * 严格按 BROWSER-3D-ACCEPTANCE.md 的 "ZIP 独立运行" 一节：
 *   1) 通过目标仓库真实交付流程导出 ZIP（POST /api/projects/:id/export?fmt=zip）
 *   2) 解压到全新临时目录（不在原项目目录，不依赖开发服务器）
 *   3) Edge 打开导出后的网页
 *   4) 重复初始化 + 至少三项交互（拖拽、选择对象、昼夜/潮位）
 *   5) 确认无外部 CDN、无原工作区绝对路径、无开发服务器依赖
 *
 * 用法：node tools/m7b4b3d/verify-zip-standalone.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const OUT = path.join(ROOT, 'docs', 'm7-b4b3d-evidence');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'm7b4b3d-zip-'));
const PORT = 19750 + Math.floor(Math.random() * 40);
const KEYS = path.join(TMP, 'keys.json');
const EDGE = process.env.RENDERCHECK_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
fs.mkdirSync(OUT, { recursive: true });

const checks = [];
const ok = (n, d = '') => { checks.push({ pass: true, n, d }); console.log(`✔ ${n}${d ? '  ' + d : ''}`); };
const bad = (n, d = '') => { checks.push({ pass: false, n, d }); console.log(`✖ ${n}  ${d}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PLAN_3D = {
  schemaVersion: 'orchestrai.pageplan.v1',
  meta: { title: '果冻海岛 3D 档案', description: '可在离线环境独立运行的三维海岛页面。', language: 'zh-CN' },
  userConstraints: { styleId: 'neumorph-blossom', fontMood: 'serif', pageDirection: 'explore', locked: true },
  designIntent: { concept: '以可环绕的三维场景作为主叙事。', pageDirection: 'explore', visualPrinciples: ['柔和粉调', '场景优先'] },
  theme: { styleId: 'neumorph-blossom', background: '#f7edf1', surface: '#ffffff', text: '#15171f', muted: '#747177', accent: '#ce125d', accentSoft: '#f0c6d6', fontMood: 'serif', density: 'airy', radius: 'rounded' },
  nodes: [
    { id: 'hero', type: 'section', variant: 'hero', title: '果冻海岛', description: '拖拽旋转，滚轮缩放。', children: [{ id: 'hero-t', type: 'text', text: '一座会呼吸的岛。' }] },
    { id: 'scene', type: 'section', title: '三维海岛', children: [
      { id: 'island-scene', type: 'scene3d', label: '可交互的果冻海岛', description: '真实 WebGL 三角网格。', height: 'wide',
        background: '#fce7f3', cameraDistance: 12,
        controls: { orbit: true, zoom: true, autoRotate: false, dayNight: true, tide: true },
        objects: [
          { id: 'water', name: '环岛海面', shape: 'disk', position: [0, -0.4, 0], scale: [10, 0.05, 8], rotation: [0, 0, 0], color: '#82d9f0', material: 'jelly', description: '外海。', selectable: true, motion: 'tide' },
          { id: 'island-main', name: '果冻岛主体', shape: 'island', position: [0, 0.1, 0], scale: [4, 1.3, 3], rotation: [0, 0, 0], color: '#f6a8ce', material: 'jelly', description: '岛体网格。', selectable: true, motion: 'none' },
          { id: 'lighthouse', name: '蜜糖灯塔', shape: 'cylinder', position: [-1.6, 0.9, 0.1], scale: [0.4, 1.3, 0.4], rotation: [0, 0, 0], color: '#fff4d6', material: 'matte', description: '岛西侧灯塔。', selectable: true, motion: 'none' },
          { id: 'village', name: '果冻渔村', shape: 'box', position: [0.7, 0.8, 0.1], scale: [0.85, 0.66, 0.75], rotation: [0, 22, 0], color: '#f9d4e6', material: 'jelly', description: '内海湾小屋。', selectable: true, motion: 'none' },
        ] },
    ] },
  ],
  unsupportedRequests: [],
};

const stub = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'stub' }] }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(PLAN_3D) } }], usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 } }));
  });
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
fs.writeFileSync(KEYS, JSON.stringify({ custom: [{ id: 'stub', label: 'Zip3D Stub', baseUrl: `http://127.0.0.1:${stub.address().port}/v1`, key: 'sk-zip3d-stub', model: 'stub' }] }));

const env = { ...process.env, PORT: String(PORT), ORCHESTRAI_KEYS_FILE: KEYS, ORCHESTRAI_PAGEPLAN: 'on' };
delete env.ORCHESTRAI_MANAGED_KEY;
const srv = spawn(process.execPath, ['index.mjs'], { cwd: path.join(ROOT, 'apps', 'server'), env, stdio: ['ignore', 'pipe', 'pipe'] });
let srvLog = ''; srv.stdout.on('data', (d) => (srvLog += d)); srv.stderr.on('data', (d) => (srvLog += d));
const API = `http://127.0.0.1:${PORT}`;
let projectId = null;
let unz = null;

try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${API}/api/styles`)).ok) break; } catch {} await sleep(300); }

  // ---- 1) 真实交付流程 ----
  const g = await fetch(`${API}/api/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'zip-3d', sentence: '做一个可环绕观察的3d果冻质感海岛网页', llm: 'custom:stub', choices: { style: 'neumorph-blossom', font: 'serif', direction: 'explore' } }),
  });
  const { jobId } = await g.json();
  let job = null;
  for (let i = 0; i < 140; i++) { await sleep(1400); job = await (await fetch(`${API}/api/jobs/${jobId}`)).json(); if (job.status !== 'running') break; }
  projectId = job?.result?.projectId ?? null;
  (job.status === 'done' && job.result?.failed === false && projectId) ? ok('真实管线交付成功', `projectId=${projectId}`) : bad('管线交付失败', JSON.stringify({ status: job.status, error: job.error, r: job.result }).slice(0, 260));

  const exp = await fetch(`${API}/api/projects/${projectId}/export?fmt=zip`);
  exp.ok ? ok('ZIP 导出成功（真实 /api/export 接口）', `HTTP ${exp.status}`) : bad('ZIP 导出失败', String(exp.status));
  const buf = Buffer.from(await exp.arrayBuffer());
  const zp = path.join(TMP, 'delivery.zip');
  fs.writeFileSync(zp, buf);
  fs.writeFileSync(path.join(OUT, 'scene3d-zip-delivery.zip'), buf);
  ok('ZIP 已保存为证据', `${Math.round(buf.length / 1024)}KB`);

  // ---- 2) 解压到全新临时目录 ----
  unz = path.join(TMP, 'standalone');
  fs.mkdirSync(unz, { recursive: true });
  execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zp}' -DestinationPath '${unz}' -Force`], { stdio: 'pipe' });
  const files = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : files.push(path.relative(unz, p).replaceAll('\\', '/')); } })(unz);
  ok('ZIP 解压到全新临时目录', `${files.length} 个文件：${files.join(', ')}`);
  (!path.resolve(unz).startsWith(path.resolve(ROOT))) ? ok('解压目录不在原项目目录内（独立运行前提）', path.relative(ROOT, unz)) : bad('解压目录落在原项目内');

  const html = fs.readFileSync(path.join(unz, 'index.html'), 'utf8');
  // ---- 5) 无外部依赖 ----
  const externalSrc = [...html.matchAll(/<(?:script|link|img)[^>]+(?:src|href)="(https?:\/\/[^"]+)"/gi)].map((m) => m[1]);
  (externalSrc.length === 0) ? ok('产物无外部 CDN/远程资源引用', '0 处') : bad('产物含外部资源引用', externalSrc.slice(0, 3).join(', '));
  (/https?:\/\/localhost|127\.0\.0\.1|:\d{4}\//.test(html)) ? bad('产物引用开发服务器地址') : ok('产物不依赖开发服务器地址');
  (html.includes(ROOT.replaceAll('\\', '/')) || html.includes(ROOT)) ? bad('产物含原工作区绝对路径') : ok('产物不含原工作区绝对路径');
  const absPaths = [...html.matchAll(/[A-Za-z]:[\\/][^"'<> ]{4,}/g)].map((m) => m[0]);
  (absPaths.length === 0) ? ok('产物不含任何本地绝对路径', '0 处') : bad('产物含本地绝对路径', absPaths.slice(0, 3).join(', '));

  // ---- 3) 真实 Edge 打开并交互 ----
  const { launchCdp } = await import(pathToFileURL(path.join(ROOT, 'apps', 'server', 'cdp-viewport.mjs')).href);
  const cdp = await launchCdp({ edgeBin: EDGE });
  let sid = null, tid = null;
  const consoleErrors = [];
  const ev = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid);
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text ?? 'eval failed');
    return r?.result?.value;
  };
  const frame = async () => ev(`(() => {
    const canvas = document.querySelector('canvas[data-scene3d-canvas]');
    const gl = canvas.getContext('webgl');
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 0, bubbles: true, cancelable: true }));
    const w = canvas.width, h = canvas.height;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let hash = 2166136261, nonBg = 0;
    for (let i = 0; i < px.length; i += 4) {
      hash ^= px[i] + px[i+1] * 7 + px[i+2] * 31 + px[i+3] * 127;
      hash = Math.imul(hash, 16777619) >>> 0;
      if (px[i] + px[i+1] + px[i+2] > 24) nonBg++;
    }
    return { hash: hash.toString(16), nonBg, glErr: gl.getError(), w, h };
  })()`);
  try {
    const t = await cdp.send('Target.createTarget', { url: 'about:blank' }); tid = t.targetId;
    sid = (await cdp.send('Target.attachToTarget', { targetId: tid, flatten: true })).sessionId;
    await cdp.send('Page.enable', {}, sid);
    await cdp.send('Runtime.enable', {}, sid);
    await cdp.send('Log.enable', {}, sid);
    cdp.onEvent((method, params) => {
      if (method === 'Runtime.exceptionThrown') consoleErrors.push(`exception: ${params?.exceptionDetails?.text ?? ''}`);
      else if (method === 'Log.entryAdded' && params?.entry?.level === 'error') consoleErrors.push(`log: ${params.entry.text ?? ''}`);
    });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }, sid);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 }, sid);

    const fileUrl = pathToFileURL(path.join(unz, 'index.html')).href;
    await cdp.send('Page.navigate', { url: fileUrl }, sid);
    await cdp.waitEvent('Page.loadEventFired', sid, 10000);
    await sleep(2400);

    const init = await ev(`(() => {
      const root = document.querySelector('[data-pageplan-scene3d]');
      const c = root?.querySelector('canvas[data-scene3d-canvas]');
      return { status: root?.dataset.scene3dStatus, w: c?.width, h: c?.height,
               glError: (() => { const gl = c?.getContext('webgl'); return gl ? gl.getError() : 'NO_GL'; })(),
               statusText: root?.querySelector('.pp-scene3d-status')?.textContent ?? '' };
    })()`);
    (init.status === 'ready' && init.glError === 0) ? ok('ZIP 独立运行：scene3d 初始化 ready（file:// 无服务器）', init.statusText.slice(0, 40)) : bad('ZIP 独立运行 3D 初始化失败', JSON.stringify(init));
    const f0 = await frame();
    (f0.nonBg > 5000) ? ok('ZIP 独立运行：画布有真实渲染内容', `nonBg=${f0.nonBg}/${f0.w * f0.h}`) : bad('ZIP 独立运行画布空白', JSON.stringify(f0));

    // 交互 A：拖拽
    await ev(`document.querySelector('canvas[data-scene3d-canvas]').scrollIntoView({ block: 'center' })`);
    await sleep(350);
    const box = await ev(`(() => { const r = document.querySelector('canvas[data-scene3d-canvas]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    const cx = Math.round(box.x + box.w / 2), cy = Math.round(box.y + box.h / 2);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, button: 'none', clickCount: 0 }, sid);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 }, sid);
    for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx + i * 18, y: cy + i * 5, button: 'left', buttons: 1 }, sid); await sleep(20); }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx + 180, y: cy + 50, button: 'left', buttons: 0, clickCount: 1 }, sid);
    await sleep(400);
    const fDrag = await frame();
    (fDrag.hash !== f0.hash) ? ok('ZIP 独立运行：拖拽旋转有效', `${f0.hash} → ${fDrag.hash}`) : bad('ZIP 独立运行：拖拽无效');

    // 交互 B：选择对象
    const pick = await ev(`(() => {
      const c = document.querySelector('canvas[data-scene3d-canvas]');
      const r = c.getBoundingClientRect();
      const x = r.x + r.width * 0.5, y = r.y + r.height * 0.56;
      c.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
      c.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
      return { name: document.querySelector('.pp-scene3d-inspector strong')?.textContent?.trim() ?? null };
    })()`);
    (pick.name && pick.name !== '环岛海面') ? ok('ZIP 独立运行：点击选中前方实体（深度拾取生效）', pick.name) : bad('ZIP 独立运行：拾取失败', JSON.stringify(pick));

    // 交互 C：昼夜
    const fDay = await frame();
    const dp = await ev(`(() => { const b = document.querySelector('[data-scene3d-action="day-night"]'); b.click(); return b.getAttribute('aria-pressed'); })()`);
    await sleep(450);
    const fNight = await frame();
    (dp === 'true' && fNight.hash !== fDay.hash) ? ok('ZIP 独立运行：昼夜切换有效', `${fDay.hash} → ${fNight.hash}`) : bad('ZIP 独立运行：昼夜无效');

    // 交互 D：潮位
    const tide = await ev(`(() => { const r = document.querySelector('[data-scene3d-tide]'); r.value = '0.18'; r.dispatchEvent(new Event('input', { bubbles: true })); return r.value; })()`);
    await sleep(450);
    const fTide = await frame();
    (fTide.hash !== fNight.hash) ? ok('ZIP 独立运行：潮位滑块有效', `value=${tide}`) : bad('ZIP 独立运行：潮位无效');

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true }, sid);
    fs.writeFileSync(path.join(OUT, 'scene3d-zip-standalone.png'), Buffer.from(shot.data, 'base64'));
    ok('ZIP 独立运行真实截图已保存', 'scene3d-zip-standalone.png');

    const realErr = consoleErrors.filter((e) => !/favicon/i.test(e));
    realErr.length === 0 ? ok('ZIP 独立运行：控制台无错误', `捕获 ${consoleErrors.length} 条`) : bad('ZIP 独立运行控制台有错误', realErr.slice(0, 3).join(' | '));
    const finalGl = await ev(`(() => { const gl = document.querySelector('canvas[data-scene3d-canvas]').getContext('webgl'); return gl ? gl.getError() : 'NO_GL'; })()`);
    finalGl === 0 ? ok('ZIP 独立运行：交互后 gl.getError()=0') : bad('ZIP 独立运行 WebGL 报错', String(finalGl));
  } finally {
    fs.writeFileSync(path.join(OUT, 'scene3d-zip-console.txt'), consoleErrors.join('\n') || '(no console errors captured)');
    if (tid) { try { await cdp.send('Target.closeTarget', { targetId: tid }); } catch {} }
    try { await cdp.close(); } catch {}
  }
} catch (e) {
  bad('ZIP 验收异常', String(e?.message ?? e).slice(0, 300));
} finally {
  try { srv.kill(); } catch {}
  stub.close(); await sleep(300);
  fs.writeFileSync(path.join(OUT, 'scene3d-zip-runtime.json'), JSON.stringify({
    testedAt: new Date().toISOString(), projectId, checks,
    note: 'ZIP 通过真实 /api/export 导出，解压到系统临时目录后用 Edge file:// 打开（不依赖开发服务器）',
  }, null, 2));
  if (projectId) { const p = path.join(ROOT, 'workspaces', projectId); if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); }
  const pass = checks.filter((c) => c.pass).length;
  console.log(`\n=== ${pass}/${checks.length} 通过 ===`);
  try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  process.exit(pass === checks.length ? 0 : 1);
}
