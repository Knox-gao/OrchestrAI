/**
 * M7-B4B 端到端验证：PagePlan 真实进管线产网页
 * 隔离：临时密钥库 + Stub 网关 + 临时工作区清理；零真实模型调用
 * 断言：
 *  1. PagePlan 成功 → 产 index.html（结构由节点树决定）
 *  2. 用户锁定 styleId/fontMood 落地到 theme
 *  3. PagePlan 失败（模型返非 JSON）→ delivered=false，不回退模板
 *  4. blocking unsupported → 阻断
 *  5. 桌面渲染门禁 pass
 *  6. ZIP 下载 + 全新目录独立运行
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'm7b4b-'));
const PORT = 19600 + Math.floor(Math.random() * 100);
const KEYS = path.join(TMP, 'keys.json');
const STUB = 'test-only-stub-key';

const PLAN_OK = {
  schemaVersion: 'orchestrai.pageplan.v1',
  meta: { title: '果冻海岛图鉴', description: '一座果冻质感海岛的可浏览风物档案。', language: 'zh-CN' },
  userConstraints: { styleId: 'neumorph-blossom', fontMood: 'serif', pageDirection: 'explore', locked: true },
  designIntent: { concept: '把果冻海岛拆成可翻阅的风物档案：先看见岛，再逐个认识岛上的地标与居民。', pageDirection: 'explore', visualPrinciples: ['柔和的粉调表面', '大留白的章节节奏', '地标优先的信息层级'] },
  theme: { styleId: 'neumorph-blossom', background: '#f7edf1', surface: '#ffffff', text: '#15171f', muted: '#747177', accent: '#ce125d', accentSoft: '#f0c6d6', fontMood: 'serif', density: 'airy', radius: 'rounded' },
  nodes: [
    { id: 'hero', type: 'section', variant: 'hero', eyebrow: 'JELLY ISLAND', title: '果冻海岛', description: '一座会呼吸的岛，十五处风物等你翻。', children: [
      { id: 'hero-text', type: 'text', text: '潮水退去时，岛上的蜜糖灯塔会先亮起来。' },
      { id: 'hero-link', type: 'link', label: '开始探索', href: '#landmarks', variant: 'primary' },
    ] },
    { id: 'landmarks', type: 'section', title: '岛屿地标', description: '四处主要地标。', children: [
      { id: 'lm-grid', type: 'container', layout: 'grid', columns: 2, children: [
        { id: 'lm-1', type: 'card', eyebrow: '地标 01', title: '蜜糖灯塔', description: '蜂蜜色的塔身，夜里透出暖光。' },
        { id: 'lm-2', type: 'card', eyebrow: '地标 02', title: '果冻渔村', description: '彩色小屋沿着浅滩排列。' },
        { id: 'lm-3', type: 'card', eyebrow: '地标 03', title: '珊瑚浅滩', description: '粉色珊瑚在透明海水下发光。' },
        { id: 'lm-4', type: 'card', eyebrow: '地标 04', title: '风车花园', description: '海风把花田吹成波浪。' },
      ] },
    ] },
    { id: 'residents', type: 'section', title: '岛民与生灵', children: [
      { id: 'res-list', type: 'list', items: [
        { title: '守塔人阿婆', text: '在灯塔住了四十年，认得每一艘夜归的船。' },
        { title: '果冻鲸', text: '半透明的巨鲸，每年冬至游过岛的南岸。' },
        { title: '萤光浮游', text: '夜里贴着水面发蓝光的小生物。' },
      ] },
    ] },
    { id: 'timeline', type: 'section', title: '岛屿纪年', children: [
      { id: 'tl', type: 'timeline', items: [
        { id: 'tl-1', date: '1892', title: '荒礁', body: '只有礁石与海鸟。' },
        { id: 'tl-2', date: '1930', title: '渔村成形', body: '第一批渔民定居。' },
        { id: 'tl-3', date: '2024', title: '风物图谱', body: '十五处风物被逐一定档。' },
      ] },
    ] },
    { id: 'limits', type: 'section', title: '关于本次生成', children: [
      { id: 'limits-callout', type: 'callout', tone: 'warning', title: '已知限制', body: '本次未实现实时 3D 环绕视角，页面以结构化风物档案呈现。' },
    ] },
  ],
  unsupportedRequests: [
    { requirementId: 'US1-accept1', capability: 'interactive-3d-scene', reason: '当前 PagePlan 渲染器不含 3D 场景能力，已用分层档案替代。', severity: 'nonblocking' },
  ],
};

const PLAN_ALT = {
  schemaVersion: 'orchestrai.pageplan.v1',
  meta: { title: '灯塔夜航手册', description: '以夜航视角重排同一主题的另一种页面结构。', language: 'zh-CN' },
  userConstraints: { styleId: 'neumorph-blossom', fontMood: 'serif', pageDirection: 'explore', locked: true },
  designIntent: { concept: '换一种信息架构：用指标与引语构建叙事节奏，而不是地标卡片网格。', pageDirection: 'explore', visualPrinciples: ['左右分栏的对照', '指标作为锚点'] },
  theme: { styleId: 'neumorph-blossom', background: '#f7edf1', surface: '#ffffff', text: '#15171f', muted: '#747177', accent: '#ce125d', accentSoft: '#f0c6d6', fontMood: 'serif', density: 'airy', radius: 'rounded' },
  nodes: [
    { id: 'night-hero', type: 'section', variant: 'panel', eyebrow: 'NIGHT PASSAGE', title: '夜航手册', children: [
      { id: 'nh-split', type: 'container', layout: 'split', children: [
        { id: 'nh-text', type: 'text', text: '熄灯之后，岛的另一套秩序才开始运转。' },
        { id: 'nh-quote', type: 'quote', text: '海不解释，只重复。', byline: '守塔人阿婆' },
      ] },
    ] },
    { id: 'figures', type: 'section', title: '夜航指标', children: [
      { id: 'fi-grid', type: 'container', layout: 'grid', columns: 3, children: [
        { id: 'fi-1', type: 'metric', value: '7', label: '座灯塔', detail: '分布于环岛七处' },
        { id: 'fi-2', type: 'metric', value: '2.4h', label: '绕岛一圈', detail: '慢速航行耗时' },
        { id: 'fi-3', type: 'metric', value: '15', label: '处风物', detail: '均已定档' },
      ] },
    ] },
    { id: 'faq', type: 'section', title: '夜航问答', children: [
      { id: 'faq-1', type: 'details', summary: '能见度低时怎么办？', children: [ { id: 'faq-1-t', type: 'text', text: '按灯塔节奏减速，等待下一轮光束。' } ] },
      { id: 'faq-2', type: 'details', summary: '潮汐表在哪看？', children: [ { id: 'faq-2-t', type: 'text', text: '渔村码头东侧的公告板每晚更新。' } ] },
    ] },
    { id: 'limits2', type: 'section', title: '关于本次生成', children: [
      { id: 'limits2-c', type: 'callout', tone: 'warning', title: '已知限制', body: '本次未实现实时 3D 环绕视角。' },
    ] },
  ],
  unsupportedRequests: [
    { requirementId: 'US1-accept1', capability: 'interactive-3d-scene', reason: '当前渲染器不含 3D 场景能力。', severity: 'nonblocking' },
  ],
};

// 模型计划里声称用了别的风格：用户锁定必须赢
const PLAN_WRONG_STYLE = {
  ...PLAN_OK,
  theme: { ...PLAN_OK.theme, styleId: 'editorial-obsidian', background: '#0b0b0f', surface: '#15151c', text: '#f2f2f5', muted: '#9a9aa8', accent: '#d4af37', accentSoft: '#2a2a33' },
  userConstraints: { ...PLAN_OK.userConstraints, styleId: 'editorial-obsidian' },
};

// 模型计划声明了本地图片但产物里不存在 → 渲染门禁必须阻断（不能假绿）
const PLAN_MISSING_ASSET = {
  ...PLAN_OK,
  nodes: [
    { id: 'hero', type: 'section', variant: 'hero', title: '果冻海岛', children: [
      { id: 'hero-img', type: 'image', src: 'images/not-there.jpg', alt: '海岛照片' },
    ] },
    ...PLAN_OK.nodes.slice(1),
  ],
};

// 含真实 scene3d 节点的计划（走应用内置 WebGL1 runtime，模型不提供任何代码）
const PLAN_3D = {
  ...PLAN_OK,
  nodes: [
    { id: 'hero', type: 'section', variant: 'hero', eyebrow: 'JELLY ISLAND 3D', title: '果冻海岛', description: '可环绕观察的岛屿场景。', children: [
      { id: 'hero-text', type: 'text', text: '拖拽旋转，滚轮缩放。' },
    ] },
    { id: 'scene', type: 'section', title: '三维海岛', children: [
      { id: 'island-scene', type: 'scene3d', label: '可交互的果冻海岛', description: '拖拽画布环绕观察。', height: 'standard',
        background: '#fce7f3', cameraDistance: 12,
        controls: { orbit: true, zoom: true, autoRotate: false, dayNight: true, tide: true },
        objects: [
          { id: 'water', name: '环岛海面', shape: 'disk', position: [0, -0.4, 0], scale: [10, 0.05, 8], rotation: [0, 0, 0], color: '#82d9f0', material: 'jelly', description: '外海。', selectable: true, motion: 'tide' },
          { id: 'island-main', name: '果冻岛主体', shape: 'island', position: [0, 0.1, 0], scale: [4, 1.3, 3], rotation: [0, 0, 0], color: '#f6a8ce', material: 'jelly', description: '真实三角网格岛体。', selectable: true, motion: 'none' },
          { id: 'lighthouse', name: '蜜糖灯塔', shape: 'cylinder', position: [-1.6, 0.9, 0.1], scale: [0.4, 1.3, 0.4], rotation: [0, 0, 0], color: '#fff4d6', material: 'matte', description: '岛西侧的灯塔。', selectable: true, motion: 'none' },
          { id: 'village', name: '果冻渔村', shape: 'box', position: [0.7, 0.8, 0.1], scale: [0.85, 0.66, 0.75], rotation: [0, 22, 0], color: '#f9d4e6', material: 'jelly', description: '内海湾的小屋。', selectable: true, motion: 'none' },
        ] },
    ] },
    { id: 'residents', type: 'section', title: '岛上风物', children: [
      { id: 'res-list', type: 'list', items: [{ title: '守塔人阿婆', text: '在灯塔住了四十年。' }] },
    ] },
  ],
  unsupportedRequests: [],
};

const stub = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'stub' }] }));
    const mode = process.env.STUB_MODE || 'ok';
    let content;
    if (mode === 'garbage') content = '这不是 JSON，模型跑偏了。';
    else if (mode === 'blocking') content = JSON.stringify({ ...PLAN_OK, unsupportedRequests: [
      { requirementId: 'US1-accept1', capability: 'interactive-3d-scene', reason: '必须有可环绕的 3D 场景，当前渲染器无法实现。', severity: 'blocking' } ] });
    else if (mode === 'alt') content = JSON.stringify(PLAN_ALT);
    else if (mode === 'wrongstyle') content = JSON.stringify(PLAN_WRONG_STYLE);
    else if (mode === 'missingasset') content = JSON.stringify(PLAN_MISSING_ASSET);
    else if (mode === 'scene3d') content = JSON.stringify(PLAN_3D);
    else content = JSON.stringify(PLAN_OK);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }));
  });
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
const stubPort = stub.address().port;

fs.writeFileSync(KEYS, JSON.stringify({ custom: [{ id: 'stub', label: 'M7B4B Stub', baseUrl: `http://127.0.0.1:${stubPort}/v1`, key: STUB, model: 'stub' }] }));
const env = { ...process.env, PORT: String(PORT), ORCHESTRAI_KEYS_FILE: KEYS, ORCHESTRAI_PAGEPLAN: 'on' };
delete env.ORCHESTRAI_MANAGED_KEY;
const srv = spawn(process.execPath, ['index.mjs'], { cwd: path.join(ROOT, 'apps', 'server'), env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
const API = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const ok = (n, d = '') => { checks.push({ pass: true, n }); console.log(`✔ ${n}${d ? '  ' + d : ''}`); };
const bad = (n, d = '') => { checks.push({ pass: false, n, d }); console.log(`✖ ${n}  ${d}`); };
const created = [];

async function gen(label, mode) {
  process.env.STUB_MODE = mode;
  const g = await fetch(`${API}/api/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: label, sentence: '帮我做一个3d果冻质感的海上小岛网站，带岛上风物介绍', llm: 'custom:stub',
      choices: { style: 'neumorph-blossom', font: 'serif', direction: 'explore' } }),
  });
  const body = await g.json();
  if (!body.jobId) return { error: body };
  let job = null;
  for (let i = 0; i < 100; i++) { await sleep(1200); job = await (await fetch(`${API}/api/jobs/${body.jobId}`)).json(); if (job.status !== 'running') break; }
  if (job?.result?.projectId) created.push(job.result.projectId);
  return job;
}

try {
  let up = false;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${API}/api/styles`)).ok) { up = true; break; } } catch {} await sleep(300); }
  if (!up) throw new Error('服务未启动: ' + log.slice(0, 300));
  ok('隔离服务启动（ORCHESTRAI_PAGEPLAN=on）');

  // ---- 1) 正常路径：PagePlan 产网页 ----
  const j1 = await gen('pp-ok', 'ok');
  const r1 = j1?.result ?? {};
  if (!r1.projectId) { console.log("DEBUG job=", JSON.stringify(j1).slice(0, 2000)); console.log('DEBUG log=', log.slice(-1500)); }
  r1.failed === false ? ok('PagePlan 生成成功', `projectId=${r1.projectId}`) : bad('PagePlan 生成失败', JSON.stringify(r1).slice(0, 200));
  if (r1.projectId) {
    const dir = path.join(ROOT, 'workspaces', r1.projectId);
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    // 结构由节点树决定：应含 hero/section/grid/card/timeline/details
    const hasGrid = html.includes('pp-grid-2');
    const hasCard = (html.match(/pp-card/g) ?? []).length >= 4;
    const hasTimeline = html.includes('pp-timeline');
    const hasCallout = html.includes('pp-callout--warning');
    (hasGrid && hasCard && hasTimeline && hasCallout) ? ok('DOM 结构由 PagePlan 节点树决定', `grid=${hasGrid} cards≥4=${hasCard} timeline=${hasTimeline} callout=${hasCallout}`) : bad('结构不符', JSON.stringify({ hasGrid, hasCard, hasTimeline, hasCallout }));
    // 用户锁定风格落地
    html.includes('--pp-bg:#f7edf1') ? ok('theme 来自真实风格注册表', '#f7edf1') : bad('主题令牌错误');
    // fontMood 影响字体栈
    /--pp-font:'Iowan Old Style'/.test(html) ? ok('fontMood=serif 影响实际字体栈') : bad('字体未生效');
    // nonblocking 限制在页面可见
    html.includes('已知限制') && html.includes('interactive-3d-scene') ? ok('nonblocking 限制在页面可见') : bad('限制未展示');
    // 无模型脚本注入
    !/<script/i.test(html) ? ok('产物不含 script 标签（无注入）') : bad('产物含 script');
    // 页面元数据
    const pj = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
    pj.delivered === true ? ok('delivered=true') : bad('delivered 非 true');
    // 渲染门禁
    const rcPath = path.join(dir, '_rendercheck', `${r1.projectId}-rendercheck.json`);
    if (fs.existsSync(rcPath)) {
      const rc = JSON.parse(fs.readFileSync(rcPath, 'utf8'));
      rc.gate.status === 'pass' ? ok('桌面渲染门禁 pass') : bad('渲染门禁 fail', rc.gate.reason.slice(0, 100));
    } else bad('无 rendercheck 证据');
    // ZIP 下载 + 独立运行
    const exp = await fetch(`${API}/api/projects/${r1.projectId}/export?fmt=zip`);
    if (exp.ok) {
      const buf = Buffer.from(await exp.arrayBuffer());
      const zp = path.join(TMP, 'out.zip'); fs.writeFileSync(zp, buf);
      const unz = path.join(TMP, 'unz'); fs.rmSync(unz, { recursive: true, force: true }); fs.mkdirSync(unz, { recursive: true });
      execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zp}' -DestinationPath '${unz}' -Force`], { stdio: 'pipe' });
      fs.existsSync(path.join(unz, 'index.html')) ? ok('ZIP 解压含 index.html', `${Math.round(buf.length / 1024)}KB`) : bad('ZIP 缺 index.html');
      const { renderCheck } = await import(pathToFileURL(path.join(ROOT, 'apps', 'server', 'rendercheck.mjs')).href);
      const rc2 = await renderCheck({ wsDir: unz, label: 'zip-pp', outDir: path.join(TMP, 'rc2') });
      rc2.gate.status === 'pass' ? ok('ZIP 全新目录独立运行 pass') : bad('ZIP 独立运行失败', rc2.gate.reason.slice(0, 100));
    } else bad('ZIP 下载失败', `status=${exp.status}`);
  }

  // ---- 2) 模型返垃圾 → 阻断，不回退模板 ----
  const j2 = await gen('pp-garbage', 'garbage');
  const r2 = j2?.result ?? {};
  (r2.failed === true && r2.blocked === 'pageplan_failed') ? ok('模型返非JSON → 阻断交付', `blocked=${r2.blocked}`) : bad('未阻断', JSON.stringify(r2).slice(0, 200));
  r2.previewUrl === null ? ok('阻断时无 previewUrl（未回退模板）') : bad('阻断仍给 previewUrl');

  // ---- 3) blocking unsupported → 阻断 ----
  const j3 = await gen('pp-blocking', 'blocking');
  const r3 = j3?.result ?? {};
  (r3.failed === true && /PAGEPLAN_BLOCKED|pageplan_failed/.test(JSON.stringify(r3))) ? ok('blocking unsupported 阻断交付') : bad('blocking 未阻断', JSON.stringify(r3).slice(0, 200));

  // ---- 4) 换一份完全不同的计划 → 页面结构必须随之改变（证明构图由模型决定，不是模板）----
  const j4 = await gen('pp-alt', 'alt');
  const r4 = j4?.result ?? {};
  if (r4.projectId) {
    const html4 = fs.readFileSync(path.join(ROOT, 'workspaces', r4.projectId, 'index.html'), 'utf8');
    const altSig = { split: html4.includes('pp-split'), metric: (html4.match(/class="pp-metric"/g) ?? []).length, quote: html4.includes('pp-quote'), details: (html4.match(/<details/g) ?? []).length };
    const hero = html4.includes('id="hero"') || html4.includes('id="landmarks"');
    const okAlt = altSig.split && altSig.metric >= 3 && altSig.quote && !hero;
    okAlt ? ok('不同计划产出不同页面结构', `split=${altSig.split} metrics=${altSig.metric} quote=${altSig.quote} 旧计划section=${hero}`)
      : bad('页面结构未随计划改变', JSON.stringify({ ...altSig, hero }));
    html4.includes('--pp-bg:#f7edf1') ? ok('第二份计划同样套用锁定主题', '#f7edf1') : bad('第二份计划主题异常');
  } else bad('不同计划生成失败', JSON.stringify(r4).slice(0, 200));

  // ---- 5) 模型计划声称别的风格 → 用户锁定风格必须赢 ----
  const j5 = await gen('pp-wrongstyle', 'wrongstyle');
  const r5 = j5?.result ?? {};
  if (r5.projectId) {
    const html5 = fs.readFileSync(path.join(ROOT, 'workspaces', r5.projectId, 'index.html'), 'utf8');
    const pj5 = JSON.parse(fs.readFileSync(path.join(ROOT, 'workspaces', r5.projectId, 'project.json'), 'utf8'));
    (html5.includes('--pp-bg:#f7edf1') && !html5.includes('#0b0b0f'))
      ? ok('用户锁定风格覆盖模型自选风格', `styleOrigin=${pj5.styleOrigin}`)
      : bad('模型计划覆盖了用户锁定风格', '页面用了 #0b0b0f');
    pj5.styleOrigin === 'user-locked' ? ok('project.json 记录 styleOrigin=user-locked') : bad('styleOrigin 记录错误', String(pj5.styleOrigin));
  } else bad('锁定覆盖测试生成失败', JSON.stringify(r5).slice(0, 200));

  // ---- 6) 计划声明了不存在的本地图片 → 渲染门禁必须阻断（不能假绿）----
  const j6 = await gen('pp-missing-asset', 'missingasset');
  const r6 = j6?.result ?? {};
  if (r6.projectId) {
    const pj6 = JSON.parse(fs.readFileSync(path.join(ROOT, 'workspaces', r6.projectId, 'project.json'), 'utf8'));
    (r6.failed === true && pj6.delivered === false)
      ? ok('图片缺失 → 渲染门禁阻断交付（fail-closed）', `delivered=${pj6.delivered}`)
      : bad('图片缺失仍交付（假绿）', JSON.stringify({ failed: r6.failed, delivered: pj6.delivered }));
    /requiredFailed|必需图片|图片/.test(pj6.testSummary ?? '') ? ok('阻断原因记录了图片缺失', (pj6.testSummary ?? '').slice(0, 80)) : bad('阻断原因未记录图片缺失', String(pj6.testSummary).slice(0, 120));
  } else bad('缺图用例未产出项目', JSON.stringify(r6).slice(0, 200));

  // ---- 7) 含 scene3d 的计划：3D 节点真实进管线，产出的页面可独立运行 ----
  const j7 = await gen('pp-3d', 'scene3d');
  const r7 = j7?.result ?? {};
  if (r7.projectId) {
    const dir7 = path.join(ROOT, 'workspaces', r7.projectId);
    const html7 = fs.readFileSync(path.join(dir7, 'index.html'), 'utf8');
    const pj7 = JSON.parse(fs.readFileSync(path.join(dir7, 'project.json'), 'utf8'));
    (pj7.delivered === true && r7.failed === false) ? ok('含 3D 的计划可正常交付', `delivered=${pj7.delivered}`) : bad('3D 计划交付失败', JSON.stringify({ failed: r7.failed, delivered: pj7.delivered, blocked: r7.blocked }));
    const hasScene = html7.includes('data-pageplan-scene3d') && html7.includes("getContext('webgl'") && html7.includes('data-scene3d-canvas');
    hasScene ? ok('产物含真实 WebGL 场景结构', 'data-pageplan-scene3d + getContext(webgl)') : bad('产物缺 3D 场景结构');
    const sceneScripts = [...html7.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter((m) => !/application\/json/i.test(m[1]));
    (sceneScripts.length === 1) ? ok('3D 页面只有 1 处可执行脚本（应用内置 runtime）') : bad('可执行脚本数量异常', String(sceneScripts.length));
    // 配置块改为 <template>（内容在 .content 里，浏览器不会当作可执行/可解析节点）
    const cfgBlocks = [...html7.matchAll(/<template[^>]*data-scene3d-config[^>]*>([\s\S]*?)<\/template>/gi)];
    let cfgOk = cfgBlocks.length === 1;
    let cfgObj = null;
    if (cfgOk) { try { cfgObj = JSON.parse(cfgBlocks[0][1]); cfgOk = cfgObj.objects.length === 4; } catch { cfgOk = false; } }
    cfgOk ? ok('3D 场景配置是合法 JSON 且对象数正确', '4 objects') : bad('3D 配置块异常');
    (cfgBlocks.length === 1 && !/<script type="application\/json"/.test(html7)) ? ok('配置走 <template>，不是可解析的 JSON script', 'template-only') : bad('配置块仍是 script 类型');
    pj7.pagePlan?.scene3d?.objects === 4 ? ok('project.json 记录 3D 对象数', String(pj7.pagePlan.scene3d.objects)) : bad('project.json 未记录 3D', JSON.stringify(pj7.pagePlan?.scene3d));
    // 门禁必须通过（说明可信 runtime 被正确放行，而不是因为"有 script 就 fail"）
    const rcPath7 = path.join(dir7, '_rendercheck', `${r7.projectId}-rendercheck.json`);
    if (fs.existsSync(rcPath7)) {
      const rc7 = JSON.parse(fs.readFileSync(rcPath7, 'utf8'));
      rc7.gate.status === 'pass' ? ok('3D 页面通过桌面渲染门禁', rc7.gate.reason.slice(0, 40)) : bad('3D 页面渲染门禁 fail', rc7.gate.reason.slice(0, 100));
    } else bad('3D 页面无 rendercheck 证据');
    // 交付物自带一致性测试（含 runtime 字节比对）
    const wsTest = fs.readFileSync(path.join(dir7, 'test', 'pageplan.test.mjs'), 'utf8');
    wsTest.includes('scene3dRuntime') ? ok('交付测试包含 runtime 字节一致性断言') : bad('交付测试缺少 runtime 断言');
  } else bad('3D 用例未产出项目', JSON.stringify(r7).slice(0, 200));
} catch (e) {
  bad('异常', String(e?.message ?? e).slice(0, 250));
} finally {
  try { srv.kill(); } catch {}
  stub.close(); await sleep(300);
  const pass = checks.filter((c) => c.pass).length;
  console.log(`\n=== ${pass}/${checks.length} 通过 ===`);
  fs.writeFileSync(path.join(TMP, 'result.json'), JSON.stringify({ checks, log: log.slice(-2000) }, null, 1));
  for (const id of created) { const p = path.join(ROOT, 'workspaces', id); if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); }
  console.log('已清理测试项目:', created.join(', ') || '(无)');
  fs.rmSync(TMP, { recursive: true, force: true });
}
