/**
 * M7-B4B 质量轮：ZIP 独立运行 + 搜索/筛选/tabs 真实浏览器交互验收
 *
 * 1) 真实 /api/export 导出 ZIP
 * 2) 解压到 %TEMP% 全新目录（不依赖开发服务器）
 * 3) Edge 以 file:// 打开
 * 4) 3D：初始化 + 拖拽 + 选中 + 昼夜 + 潮位 + glError
 * 5) 交互：搜索输入过滤、筛选按钮、tabs 鼠标点击 + 键盘方向键 + Home/End
 * 6) 无外部依赖检查
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const OUT = path.join(ROOT, 'docs', 'm7-b4bq-evidence');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'm7b4bq-zipqa-'));
const PORT = 19920 + Math.floor(Math.random() * 40);
const KEYS = path.join(TMP, 'keys.json');
const EDGE = process.env.RENDERCHECK_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
fs.mkdirSync(OUT, { recursive: true });

const checks = [];
const ok = (n, d = '') => { checks.push({ pass: true, n, d }); console.log(`✔ ${n}${d ? '  ' + d : ''}`); };
const bad = (n, d = '') => { checks.push({ pass: false, n, d }); console.log(`✖ ${n}  ${d}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PLAN = {
  schemaVersion: 'orchestrai.pageplan.v1',
  meta: { title: '果冻海岛 · 交付验收', description: '同时含 3D 场景与搜索/筛选/tabs 的离线交付页。', language: 'zh-CN' },
  userConstraints: { styleId: 'neumorph-blossom', fontMood: 'serif', pageDirection: 'explore', locked: true },
  designIntent: { concept: '可探索的岛屿档案。', pageDirection: 'explore', visualPrinciples: ['场景优先', '可检索档案'] },
  theme: { styleId: 'neumorph-blossom', background: '#f7edf1', surface: '#ffffff', text: '#15171f', muted: '#747177', accent: '#ce125d', accentSoft: '#f0c6d6', fontMood: 'serif', density: 'airy', radius: 'rounded' },
  nodes: [
    { id: 'hero', type: 'section', variant: 'hero', title: '果冻海岛', description: '离线可用的交互交付页。', children: [{ id: 'hero-t', type: 'text', text: '拖拽旋转，搜索筛选。' }] },
    { id: 'scene', type: 'section', title: '三维海岛', children: [{
      id: 'island-scene', type: 'scene3d', label: '可交互的果冻海岛', description: '真实网格。', height: 'standard',
      background: '#fce7f3', cameraDistance: 12, shadows: true,
      controls: { orbit: true, zoom: true, autoRotate: false, dayNight: true, tide: true },
      objects: [
        { id: 'water', name: '潟湖', shape: 'disk', position: [0, -0.4, 0], scale: [10, 0.05, 8], rotation: [0, 0, 0], color: '#82d9f0', material: 'water', description: '水面。', selectable: true, motion: 'tide' },
        { id: 'terrain', name: '岛体', shape: 'terrain', position: [0, 0, 0], scale: [4, 1.4, 3], rotation: [0, 0, 0], color: '#f6a8ce', material: 'jelly', description: '岛体地形。', selectable: true, motion: 'none' },
        { id: 'lighthouse', name: '灯塔', shape: 'lighthouse', position: [-1.6, 0.9, 0.1], scale: [0.6, 0.6, 0.6], rotation: [0, 0, 0], color: '#fff4d6', material: 'matte', description: '复合灯塔。', selectable: true, motion: 'none' },
        { id: 'house', name: '渔村主屋', shape: 'house', position: [0.7, 0.8, 0.1], scale: [1, 0.9, 0.9], rotation: [0, 22, 0], color: '#f9d4e6', material: 'jelly', description: '复合民居。', selectable: true, motion: 'none' },
        { id: 'palm', name: '棕榈', shape: 'tree', position: [1.6, 0.7, -0.8], scale: [1, 1, 1], rotation: [0, 30, 0], color: '#8ecfa4', material: 'foliage', description: '复合棕榈。', selectable: true, motion: 'none' },
      ] }] },
    { id: 'archive', type: 'section', title: '岛屿档案', description: '可按名称搜索，也可按类别筛选。', children: [
      { id: 'archive-search', type: 'search', targetId: 'archive-grid', label: '搜索岛屿档案', placeholder: '输入名称或描述' },
      { id: 'archive-filter', type: 'filter', targetId: 'archive-grid', label: '按类别筛选', options: [{ tag: 'flora', label: '植物' }, { tag: 'building', label: '建筑' }] },
      { id: 'archive-grid', type: 'container', layout: 'grid', columns: 2, children: [
        { id: 'card-palm', type: 'card', eyebrow: 'FLORA', title: '荧光棕榈', description: '夜里会发亮的棕榈。', tags: ['flora'] },
        { id: 'card-lighthouse', type: 'card', eyebrow: 'BUILDING', title: '蜜糖灯塔', description: '岛西侧的老灯塔。', tags: ['building'] },
        { id: 'card-house', type: 'card', eyebrow: 'BUILDING', title: '渔村主屋', description: '带坡屋顶的小屋。', tags: ['building'] },
      ] },
    ] },
    { id: 'details', type: 'section', title: '更多', children: [
      { id: 'tabs-main', type: 'tabs', label: '岛屿说明', initialTab: 'overview', panels: [
        { id: 'overview', label: '概览', children: [{ id: 'ov-t', type: 'text', text: '这是一座虚构的果冻海岛。' }] },
        { id: 'history', label: '纪年', children: [{ id: 'hi-t', type: 'text', text: '1892 年只有礁石。' }] },
        { id: 'notes', label: '备注', children: [{ id: 'no-t', type: 'text', text: '材质为风格化高光。' }] },
      ] },
    ] },
  ],
  unsupportedRequests: [],
};

const stub = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'stub' }] }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(PLAN) } }], usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 } }));
  });
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
fs.writeFileSync(KEYS, JSON.stringify({ custom: [{ id: 'stub', label: 'ZipQA', baseUrl: `http://127.0.0.1:${stub.address().port}/v1`, key: 'sk-zipqa-stub', model: 'stub' }] }));

const env = { ...process.env, PORT: String(PORT), ORCHESTRAI_KEYS_FILE: KEYS, ORCHESTRAI_PAGEPLAN: 'on' };
delete env.ORCHESTRAI_MANAGED_KEY;
const srv = spawn(process.execPath, ['index.mjs'], { cwd: path.join(ROOT, 'apps', 'server'), env, stdio: ['ignore', 'pipe', 'pipe'] });
const API = `http://127.0.0.1:${PORT}`;
let projectId = null;

try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${API}/api/styles`)).ok) break; } catch {} await sleep(300); }
  const g = await fetch(`${API}/api/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'zip-qa', sentence: '做一个带 3D 海岛和档案搜索的页面', llm: 'custom:stub', choices: { style: 'neumorph-blossom', font: 'serif', direction: 'explore' } }),
  });
  const { jobId } = await g.json();
  let job = null;
  for (let i = 0; i < 140; i++) { await sleep(1400); job = await (await fetch(`${API}/api/jobs/${jobId}`)).json(); if (job.status !== 'running') break; }
  projectId = job?.result?.projectId ?? null;
  (job.status === 'done' && job.result?.failed === false && projectId) ? ok('管线交付成功', `projectId=${projectId}`) : bad('管线交付失败', JSON.stringify({ s: job.status, e: job.error, r: job.result }).slice(0, 240));

  const exp = await fetch(`${API}/api/projects/${projectId}/export?fmt=zip`);
  exp.ok ? ok('ZIP 导出成功', `HTTP ${exp.status}`) : bad('ZIP 导出失败', String(exp.status));
  const buf = Buffer.from(await exp.arrayBuffer());
  const zp = path.join(TMP, 'delivery.zip');
  fs.writeFileSync(zp, buf);
  fs.writeFileSync(path.join(OUT, 'qa-zip-delivery.zip'), buf);

  const unz = path.join(TMP, 'standalone');
  fs.mkdirSync(unz, { recursive: true });
  execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zp}' -DestinationPath '${unz}' -Force`], { stdio: 'pipe' });
  const html = fs.readFileSync(path.join(unz, 'index.html'), 'utf8');
  ok('ZIP 解压完成', `${(buf.length / 1024).toFixed(0)}KB → ${unz.replace(ROOT, '<tmp>')}`);

  const external = [...html.matchAll(/<(?:script|link|img)[^>]+(?:src|href)="(https?:\/\/[^"]+)"/gi)].map((m) => m[1]);
  (external.length === 0) ? ok('产物无外部 CDN/远程资源', '0 处') : bad('产物含外部资源', external.slice(0, 3).join(', '));
  (!/localhost|127\.0\.0\.1/.test(html)) ? ok('产物不依赖开发服务器') : bad('产物引用开发服务器');
  (!/[A-Za-z]:[\\/][^"'<> ]{4,}/.test(html)) ? ok('产物不含本地绝对路径') : bad('产物含绝对路径');

  // ---- 真实 Edge file:// ----
  const { launchCdp } = await import(pathToFileURL(path.join(ROOT, 'apps', 'server', 'cdp-viewport.mjs')).href);
  const cdp = await launchCdp({ edgeBin: EDGE });
  const consoleErrors = [];
  cdp.onEvent((m, p) => {
    if (m === 'Runtime.exceptionThrown') consoleErrors.push('EXC ' + (p?.exceptionDetails?.exception?.description ?? '').slice(0, 180));
    else if (m === 'Log.entryAdded' && p?.entry?.level === 'error') consoleErrors.push('LOG ' + String(p.entry.text ?? '').slice(0, 180));
  });
  let sid = null, tid = null;
  const ev = (expr) => cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid)
    .then((r) => { if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; });
  const frame = () => ev(`(() => {
    const c = document.querySelector('canvas[data-scene3d-canvas]');
    if (!c) return null;
    const gl = c.getContext('webgl');
    c.dispatchEvent(new WheelEvent('wheel', { deltaY: 0, bubbles: true, cancelable: true }));
    const px = new Uint8Array(c.width * c.height * 4);
    gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let h = 2166136261, nonBg = 0;
    for (let i = 0; i < px.length; i += 4) { h ^= px[i] + px[i+1] * 7 + px[i+2] * 31 + px[i+3] * 127; h = Math.imul(h, 16777619) >>> 0; if (px[i]+px[i+1]+px[i+2] > 24) nonBg++; }
    return { hash: h.toString(16), nonBg, glErr: gl.getError(), w: c.width, h: c.height };
  })()`);

  try {
    const t = await cdp.send('Target.createTarget', { url: 'about:blank' }); tid = t.targetId;
    sid = (await cdp.send('Target.attachToTarget', { targetId: tid, flatten: true })).sessionId;
    await cdp.send('Page.enable', {}, sid);
    await cdp.send('Runtime.enable', {}, sid);
    await cdp.send('Log.enable', {}, sid);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }, sid);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 }, sid);
    await cdp.send('Page.navigate', { url: pathToFileURL(path.join(unz, 'index.html')).href }, sid);
    await cdp.waitEvent('Page.loadEventFired', sid, 12000);
    await sleep(2800);

    // 3D
    const st = await ev(`(() => { const r = document.querySelector('[data-pageplan-scene3d]'); return { status: r?.dataset.scene3dStatus, metrics: r?.dataset.scene3dMetrics ? JSON.parse(r.dataset.scene3dMetrics) : null, grounded: r?.dataset.scene3dGrounded }; })()`);
    (st.status === 'ready') ? ok('ZIP file:// 3D 初始化 ready', `${st.metrics?.meshes} 网格 / ${st.metrics?.triangles} 三角形`) : bad('ZIP 3D 未就绪', JSON.stringify(st).slice(0, 160));
    const f0 = await frame();
    (f0.nonBg > 5000) ? ok('ZIP file:// 画布有真实渲染', `nonBg=${f0.nonBg}`) : bad('ZIP 画布空白');

    // 拖拽
    await ev(`document.querySelector('canvas[data-scene3d-canvas]').scrollIntoView({block:'center'})`);
    await sleep(350);
    const box = await ev(`(() => { const r = document.querySelector('canvas[data-scene3d-canvas]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    const cx = Math.round(box.x + box.w / 2), cy = Math.round(box.y + box.h / 2);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 }, sid);
    for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx + i * 16, y: cy + i * 4, button: 'left', buttons: 1 }, sid); await sleep(20); }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx + 160, y: cy + 40, button: 'left', buttons: 0, clickCount: 1 }, sid);
    await sleep(450);
    const fDrag = await frame();
    (fDrag.hash !== f0.hash) ? ok('ZIP file:// 拖拽有效') : bad('ZIP 拖拽无效');

    // 选中
    const pick = await ev(`(() => {
      const btns = [...document.querySelectorAll('[data-scene3d-select]')];
      const b = btns.find(x => /lighthouse/.test(x.getAttribute('data-scene3d-select'))) ?? btns[0];
      b.click();
      return { name: document.querySelector('.pp-scene3d-inspector strong')?.textContent?.trim(), selected: document.querySelector('[data-scene3d-selected]')?.getAttribute('data-scene3d-selected'), pressed: btns.filter(x => x.getAttribute('aria-pressed') === 'true').length };
    })()`);
    (pick.selected && pick.pressed === 1) ? ok('ZIP file:// 对象选中有效', `${pick.name}`) : bad('ZIP 选中失败', JSON.stringify(pick));

    // 昼夜 + 潮位
    await ev(`document.querySelector('[data-scene3d-action="day-night"]')?.click()`);
    await sleep(400);
    const fNight = await frame();
    (fNight.hash !== fDrag.hash) ? ok('ZIP file:// 昼夜切换有效') : bad('ZIP 昼夜无效');
    await ev(`(() => { const r = document.querySelector('[data-scene3d-tide]'); r.value = '0.18'; r.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(400);
    const fTide = await frame();
    (fTide.hash !== fNight.hash) ? ok('ZIP file:// 潮位有效') : bad('ZIP 潮位无效');

    // ---- 搜索 ----
    const search = await ev(`(() => {
      const input = document.querySelector('[data-pp-search-target]');
      if (!input) return { err: 'no input' };
      input.value = '灯塔';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const cards = [...document.querySelectorAll('[data-pp-item]')];
      const visible = cards.filter(c => !c.hidden).map(c => c.id);
      const status = document.querySelector('[data-pp-collection-status]')?.textContent ?? '';
      return { total: cards.length, visible, status };
    })()`);
    (search.visible?.length === 1 && search.visible[0] === 'card-lighthouse') ? ok('搜索真实过滤（输入"灯塔"只剩 1 条）', `visible=${search.visible.join(',')} status=${search.status}`) : bad('搜索过滤异常', JSON.stringify(search));

    // ---- 筛选 ----
    const filter = await ev(`(() => {
      const input = document.querySelector('[data-pp-search-target]');
      input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));
      const btn = [...document.querySelectorAll('[data-pp-filter-target]')].find(b => b.getAttribute('data-pp-filter-tag') === 'building');
      if (!btn) return { err: 'no filter btn' };
      btn.click();
      const cards = [...document.querySelectorAll('[data-pp-item]')];
      return { visible: cards.filter(c => !c.hidden).map(c => c.id), pressed: btn.getAttribute('aria-pressed') };
    })()`);
    (filter.visible?.length === 2 && filter.pressed === 'true') ? ok('筛选真实生效（building → 2 条）', `visible=${filter.visible.join(',')}`) : bad('筛选异常', JSON.stringify(filter));

    // ---- tabs：鼠标 ----
    const tabClick = await ev(`(() => {
      const btns = [...document.querySelectorAll('[data-pp-tab-button]')];
      const b = btns.find(x => x.getAttribute('data-pp-tab-button') === 'history');
      b.click();
      const panels = [...document.querySelectorAll('[data-pp-tab-panel]')];
      return { selected: btns.filter(x => x.getAttribute('aria-selected') === 'true').map(x => x.getAttribute('data-pp-tab-button')), visiblePanels: panels.filter(p => !p.hidden).map(p => p.getAttribute('data-pp-tab-panel')) };
    })()`);
    (tabClick.selected?.[0] === 'history' && tabClick.visiblePanels?.length === 1 && tabClick.visiblePanels[0] === 'history') ? ok('tabs 鼠标点击切换面板', `selected=${tabClick.selected.join(',')}`) : bad('tabs 点击异常', JSON.stringify(tabClick));

    // ---- tabs：键盘 ----
    await ev(`document.querySelector('[data-pp-tab-button="history"]').focus()`);
    for (const key of ['ArrowRight', 'Home', 'End']) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: 0 }, sid);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: 0 }, sid);
      await sleep(120);
    }
    const tabKeys = await ev(`(() => {
      const btns = [...document.querySelectorAll('[data-pp-tab-button]')];
      return { selected: btns.filter(x => x.getAttribute('aria-selected') === 'true').map(x => x.getAttribute('data-pp-tab-button')), focused: document.activeElement?.getAttribute('data-pp-tab-button') ?? null };
    })()`);
    (tabKeys.selected?.[0] === 'notes' && tabKeys.focused === 'notes') ? ok('tabs 键盘方向键/Home/End 生效（End → notes 且焦点跟随）', JSON.stringify(tabKeys)) : bad('tabs 键盘异常', JSON.stringify(tabKeys));

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true }, sid);
    fs.writeFileSync(path.join(OUT, 'qa-zip-standalone.png'), Buffer.from(shot.data, 'base64'));
    ok('ZIP 独立运行截图已保存');

    const finalGl = await ev(`(() => { const gl = document.querySelector('canvas[data-scene3d-canvas]').getContext('webgl'); return gl ? gl.getError() : 'NO_GL'; })()`);
    (finalGl === 0) ? ok('ZIP file:// 交互后 glError=0') : bad('ZIP glError 非 0', String(finalGl));
    const realErr = consoleErrors.filter((e) => !/favicon/i.test(e));
    (realErr.length === 0) ? ok('ZIP file:// 控制台无错误', `${consoleErrors.length} 条`) : bad('ZIP 控制台有错误', realErr.slice(0, 3).join(' | '));
  } finally {
    fs.writeFileSync(path.join(OUT, 'qa-zip-console.txt'), consoleErrors.join('\n') || '(no console errors captured)');
    if (tid) { try { await cdp.send('Target.closeTarget', { targetId: tid }); } catch {} }
    try { await cdp.close(); } catch {}
  }
} catch (e) {
  bad('ZIP QA 异常', String(e?.message ?? e).slice(0, 300));
} finally {
  try { srv.kill(); } catch {}
  stub.close(); await sleep(300);
  const pass = checks.filter((c) => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'qa-zip-runtime.json'), JSON.stringify({
    testedAt: new Date().toISOString(), projectId, checks,
    note: 'ZIP 由真实 /api/export 导出，解压到 %TEMP% 全新目录，Edge file:// 打开（无开发服务器）',
  }, null, 2));
  // 精确清理本次 %TEMP% 隔离目录；workspaces 项目只报告不删除
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  if (projectId) {
    const p = path.join(ROOT, 'workspaces', projectId);
    console.log(`\n本次创建的 workspaces 项目（删除需用户明确同意）：${p}`);
    fs.writeFileSync(path.join(OUT, 'qa-cleanup-manifest.json'), JSON.stringify({
      policy: 'PROJECT-DELETION-CONTROL.md：必须先获得用户明确同意',
      projects: [{ id: projectId, path: p, note: 'ZIP 验收产物；可安全删除但需确认' }],
    }, null, 2));
  }
  console.log(`\n=== ${pass}/${checks.length} 通过 ===`);
  process.exit(pass === checks.length ? 0 : 1);
}
