/**
 * Visual Capability Registry（Scene Composer 实验层）
 * 每项能力 = 注册表元数据 + 代码生成函数（参数来自 Creative Director 的方案 JSON）。
 * 结构与动效质量由能力池保证；文案/数据/配色/编排由 Director 决定——这就是"Composer 产出"的边界。
 * 验证状态：种子代码均来自已实证原型（showcase/metaphor/breakthrough），本文件为参数化封装（首次运行时验证）。
 */
export const REGISTRY = {
  cinematicStage: {
    desc: '电影级舞台：体积光束/漂浮尘粒/暗角/定场字幕（Canvas 2D）',
    input: { title: '', sub: '', kick: '', beamColor: '#hex', dustColor: '#hex', bgTop: '#hex', bgBottom: '#hex' },
    perf: '低（2D canvas，~170 粒子）', deps: '无',
    mobile: '同实现', fallback: 'canvas 不可用→静态渐变',
    verified: '种子实证（showcase/cinematic），参数化待验证',
  },
  flowField: {
    desc: 'GPU 生物荧光粒子流场（原生 WebGL 着色器，指针搅动发光）',
    input: { count: 12000, dim: '#hex', lit: '#hex', bg: '#hex', stirLabel: '' },
    perf: '中高（WebGL，滚出视口自动暂停）', deps: '无（原生 WebGL）',
    mobile: '同实现（dpr 上限 1.5）', fallback: 'WebGL 失败→提示面板（静态深底）',
    verified: '种子实证（showcase/generative + full/S3）',
  },
  pressureType: {
    desc: '动态排印：滚动驱动字距/字重压缩（排印即数据）',
    input: { stages: ['短语1', '短语2', '短语3'], from: { spacing: 0.34, weight: 200 }, to: { spacing: 0.02, weight: 700 }, meta: '' },
    perf: '低', deps: '无', mobile: '同实现', fallback: '无（纯 CSS+JS）',
    verified: '种子实证（showcase/editorial + full/S2）',
  },
  dataLedger: {
    desc: '数据带档案：行式记录（编号/主体/叙述/指标），等宽数据',
    input: { kicker: '', heading: '', records: [{ no: '', name: '', en: '', note: '', stats: [['k', 'v']] }] },
    perf: '低（静态）', deps: '无', mobile: '单列重组', fallback: '无',
    verified: '种子实证（full/S4）',
  },
  productStage: {
    desc: '产品舞台：程序化产品主视觉 + 拖拽旋转 + 规格高亮（SVG/Canvas 2D）',
    input: { name: '', tagline: '', form: 'visor|cylinder|slab', accent: '#hex', specs: [['k', 'v']] },
    perf: '低中', deps: '无', mobile: '拖转改触摸滑动', fallback: '无',
    verified: '新实现（本轮验证）',
  },
  ledgerClose: {
    desc: '结束幕：沉积底纹 + 主 CTA（呼吸光晕）+ 尾注',
    input: { heading: '', note: '', cta: '', accent: '#hex', foot: '' },
    perf: '低', deps: '无', mobile: '同实现', fallback: '无',
    verified: '种子实证（full/S5）',
  },
  galleryWall: {
    desc: '作品墙：非对称错位网格 + 悬停倾斜（程序化占位卡，无外部图）',
    input: { kicker: '', works: [{ t: '', y: '', d: '', hue: 0 }] },
    perf: '低', deps: '无', mobile: '单列', fallback: '无',
    verified: '新实现（本轮验证）',
  },
};

/* ---------- 转场机制库（滚动驱动；reduced-motion 跳过中间态） ---------- */
export const TRANSITIONS = {
  decomposeGrid: {
    desc: '语义转场：上一幕短语字符随滚动散解，重组为下一幕的网格底纹',
    params: { fromPhrase: '', toKicker: '' },
  },
  inkExpand: { desc: '色彩吞没：下一幕主色自中心圆形扩张吞没视口', params: { color: '#hex' } },
  depthPush: { desc: '景深推近：下一幕自模糊远处（scale .86 + blur）推至焦点', params: {} },
  letterformHandoff: { desc: '字形交接：上一幕末字放大成为下一幕背景巨字', params: { glyph: '', color: '#hex' } },
};

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ================= 场景能力代码生成 ================= */
export function renderScene(scene) {
  const p = scene.params ?? {};
  const id = scene.id;
  switch (scene.capability) {
    case 'cinematicStage': return {
      html: `<section class="sc-${id} sc-cine" id="${id}"><div class="cine-sticky"><canvas class="cine-cv"></canvas>
  <div class="cine-vig"></div>
  <div class="cine-title"><div class="kick">${esc(p.kick)}</div><h1>${esc(p.title)}</h1><div class="sub">${esc(p.sub)}</div></div>
  <div class="cine-cue">向下滚动 ↓</div></div></section>`,
      css: `.sc-cine { height: 210vh; } .sc-cine .cine-sticky { position:sticky; top:0; height:100vh; overflow:hidden; }
.sc-cine canvas { position:absolute; inset:0; width:100%; height:100%; }
.cine-vig { position:absolute; inset:0; pointer-events:none; background:radial-gradient(ellipse at 50% 40%, transparent 44%, rgba(0,1,3,.62) 80%, rgba(0,1,3,.94) 100%); }
.cine-title { position:absolute; left:50%; top:16%; transform:translateX(-50%); text-align:center; pointer-events:none; width:92%; }
.cine-title .kick { font:400 10px/1 ui-monospace,monospace; letter-spacing:.6em; color:${esc(p.accent ?? '#7fd8ff')}; margin-bottom:18px; }
.cine-title h1 { font-weight:300; font-size:clamp(38px,6vw,80px); letter-spacing:.5em; text-indent:.5em; color:${esc(p.ink ?? '#e6eff5')}; margin:0; }
.cine-title .sub { margin-top:14px; font:300 11.5px/1 ui-monospace,monospace; letter-spacing:.4em; color:rgba(230,239,245,.55); }
.cine-cue { position:absolute; left:50%; bottom:36px; transform:translateX(-50%); font:400 10px/1 ui-monospace,monospace; letter-spacing:.44em; color:rgba(230,239,245,.5); animation:cineBob 2.6s infinite; }
@keyframes cineBob { 50% { transform:translate(-50%,8px); opacity:.5; } }
@media (prefers-reduced-motion:reduce){ .cine-cue{animation:none} }`,
      js: CINE_JS(p),
    };
    case 'pressureType': return {
      html: `<section class="sc-${id} sc-press" id="${id}"><div class="press-sticky">
  <div class="press-tag">${esc(p.kicker ?? '')}</div><h2 class="press-h"></h2>
  <p class="press-p">${esc(p.note ?? '')}</p><div class="press-meta"></div></div></section>`,
      css: `.sc-press { height: 250vh; } .sc-press .press-sticky { position:sticky; top:0; height:100vh; display:grid; place-content:center; text-align:center; }
.press-tag { font:400 10px/1 ui-monospace,monospace; letter-spacing:.5em; color:${esc(p.accent ?? '#4de8b4')}; margin-bottom:4vh; }
.press-h { font-weight:${p.from?.weight ?? 200}; font-size:clamp(32px,5.6vw,72px); letter-spacing:${p.from?.spacing ?? 0.34}em; margin:0; }
.press-p { margin-top:3.4vh; font-size:14px; color:rgba(220,235,240,.6); }
.press-meta { margin-top:2.4vh; font:400 11px/1 ui-monospace,monospace; letter-spacing:.3em; color:${esc(p.accent ?? '#7fd8ff')}; }`,
      js: PRESS_JS(p, id),
    };
    case 'flowField': return {
      html: `<section class="sc-${id} sc-flow" id="${id}"><div class="flow-sticky"><div class="flow-frame">
  <div class="flow-label">${esc(p.label ?? 'LIVE FEED')}</div><canvas class="flow-cv"></canvas>
  <div class="flow-hint">${esc(p.stirLabel ?? '移动指针搅动 · 扰动使其发光')}</div></div>
  <aside class="flow-side">${typeof p.side === 'string' && p.side.length > 8 ? esc(p.side) : ''}</aside></div></section>`,
      css: `.sc-flow { height: 190vh; } .sc-flow .flow-sticky { position:sticky; top:0; height:100vh; display:flex; align-items:center; overflow:hidden; }
.flow-frame { position:relative; width:min(880px,84vw); height:min(560px,62vh); margin:0 auto; border:1px solid rgba(127,216,255,.35); background:${esc(p.bg ?? '#01080a')}; box-shadow:0 0 0 8px rgba(2,10,14,.8), 0 0 40px ${esc(p.lit ?? '#4de8b4')}22, 0 30px 90px rgba(0,0,0,.6); }
.flow-frame canvas { width:100%; height:100%; }
.flow-label { position:absolute; top:-28px; left:0; font:400 10px/1 ui-monospace,monospace; letter-spacing:.4em; color:rgba(220,235,240,.55); }
.flow-hint { position:absolute; left:0; right:0; bottom:12px; text-align:center; font:400 10px/1 ui-monospace,monospace; letter-spacing:.4em; color:rgba(220,235,240,.5); pointer-events:none; }
.flow-side { position:absolute; right:clamp(16px,4vw,52px); bottom:38px; max-width:260px; font:400 10.5px/2 ui-monospace,monospace; letter-spacing:.16em; color:rgba(220,235,240,.6); text-align:right; }
@media (max-width:760px){ .flow-frame{height:54vh} .flow-side{position:static;margin-top:12px;text-align:left} }`,
      js: FLOW_JS(p, id),
    };
    case 'productStage': return {
      html: `<section class="sc-${id} sc-prod" id="${id}">
  <div class="prod-grid">
    <div class="prod-view"><canvas class="prod-cv" width="640" height="640"></canvas><div class="prod-hint">拖拽旋转 · 点击部件高亮</div></div>
    <div class="prod-info"><div class="prod-kick">${esc(p.kicker ?? '')}</div><h2>${esc(p.name)}</h2>
      <p class="prod-tag">${esc(p.tagline)}</p>
      <dl class="prod-specs">${(p.specs ?? []).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      <a class="prod-cta" href="#${esc(p.ctaTarget ?? 'close')}">${esc(p.cta ?? '立即预定')}</a></div>
  </div></section>`,
      css: `.sc-prod { min-height:100vh; display:grid; align-content:center; padding:12vh clamp(22px,6vw,90px); background:${esc(p.bg ?? '#0b0c10')}; }
.prod-grid { display:grid; grid-template-columns: minmax(0,1.1fr) minmax(0,1fr); gap:clamp(24px,5vw,80px); align-items:center; max-width:1240px; margin:0 auto; }
.prod-view { position:relative; } .prod-cv { width:100%; aspect-ratio:1; cursor:grab; touch-action:none; display:block; }
.prod-hint { text-align:center; font:400 10px/1 ui-monospace,monospace; letter-spacing:.34em; color:rgba(220,235,240,.45); margin-top:10px; }
.prod-kick { font:400 10px/1 ui-monospace,monospace; letter-spacing:.44em; color:${esc(p.accent ?? '#7fd8ff')}; margin-bottom:16px; }
.prod-info h2 { font-weight:300; font-size:clamp(34px,4.4vw,58px); letter-spacing:.2em; margin:0; color:${esc(p.ink ?? '#eef4f8')}; }
.prod-tag { margin-top:14px; font-size:14.5px; line-height:2; color:rgba(220,235,240,.62); max-width:44ch; }
.prod-specs { display:grid; grid-template-columns:1fr 1fr; gap:1px; background:rgba(220,235,240,.12); border:1px solid rgba(220,235,240,.12); margin:26px 0; }
.prod-specs > div { background:${esc(p.bg ?? '#0b0c10')}; padding:12px 14px; }
.prod-specs dt { font:400 9px/1 ui-monospace,monospace; letter-spacing:.24em; color:rgba(220,235,240,.45); margin-bottom:6px; }
.prod-specs dd { font:400 15px/1.3 ui-monospace,monospace; color:${esc(p.ink ?? '#eef4f8')}; margin:0; }
.prod-cta { display:inline-block; margin-top:8px; padding:14px 38px; border:1px solid ${esc(p.accent ?? '#7fd8ff')}; color:${esc(p.accent ?? '#7fd8ff')}; text-decoration:none; font:400 12px/1 ui-monospace,monospace; letter-spacing:.36em; transition:all .2s; }
.prod-cta:hover { background:${esc(p.accent ?? '#7fd8ff')}1f; box-shadow:0 0 30px ${esc(p.accent ?? '#7fd8ff')}44; }
@media (max-width:860px){ .prod-grid{grid-template-columns:1fr} }`,
      js: PROD_JS(p, id),
    };
    case 'galleryWall': return {
      html: `<section class="sc-${id} sc-gal" id="${id}">
  <div class="gal-kick">${esc(p.kicker ?? '')}</div><h2 class="gal-h">${esc(p.heading ?? '')}</h2>
  <div class="gal-wall">${(p.works ?? []).map((w, i) => `<figure class="gal-card g${i % 5}" style="--h:${w.hue ?? i * 47 % 360}">
    <div class="gal-visual"></div><figcaption><b>${esc(w.t)}</b><span>${esc(w.y)}</span><p>${esc(w.d)}</p></figcaption></figure>`).join('')}</div></section>`,
      css: `.sc-gal { padding:14vh clamp(22px,6vw,90px); }
.gal-kick { font:400 10px/1 ui-monospace,monospace; letter-spacing:.44em; color:${esc(p.accent ?? '#e8b96a')}; margin-bottom:14px; }
.gal-h { font-weight:300; font-size:clamp(30px,4vw,52px); letter-spacing:.22em; margin-bottom:7vh; color:${esc(p.ink ?? '#efe9dc')}; }
.gal-wall { display:grid; grid-template-columns:repeat(6,1fr); gap:18px; max-width:1280px; }
.gal-card { margin:0; background:rgba(255,252,244,.045); border:1px solid rgba(255,252,244,.12); overflow:hidden; transition:transform .2s, border-color .2s; cursor:default; }
.gal-card { --tilt:-.8deg; } .gal-card:nth-child(even) { --tilt:.7deg; }
.gal-card:hover { transform:translateY(-6px) rotate(var(--tilt)); border-color:hsl(var(--h) 62% 62% / .6); }
.gal-visual { aspect-ratio:4/3; background:linear-gradient(150deg, hsl(var(--h) 38% 26%), hsl(calc(var(--h) + 40) 30% 12%)); position:relative; }
.gal-visual::after { content:''; position:absolute; inset:0; background:radial-gradient(circle at 30% 25%, hsl(var(--h) 70% 70% / .25), transparent 60%); }
.g0 { grid-column:span 3; } .g1 { grid-column:span 3; margin-top:9vh; } .g2 { grid-column:span 2; margin-top:-4vh; } .g3 { grid-column:span 4; } .g4 { grid-column:span 3; margin-top:6vh; }
.gal-card figcaption { padding:14px 16px; } .gal-card b { font-size:15px; letter-spacing:.1em; color:${esc(p.ink ?? '#efe9dc')}; font-weight:500; }
.gal-card span { font:400 10px/1 ui-monospace,monospace; letter-spacing:.2em; color:rgba(239,233,220,.5); margin-left:10px; }
.gal-card p { margin:8px 0 0; font-size:12.5px; line-height:1.85; color:rgba(239,233,220,.6); }
@media (max-width:860px){ .gal-wall{grid-template-columns:1fr} .g0,.g1,.g2,.g3,.g4{grid-column:auto;margin-top:0} }`,
      js: '',
    };
    case 'dataLedger': return {
      html: `<section class="sc-${id} sc-ledger" id="${id}">
  <div class="lg-kick">${esc(p.kicker)}</div><h2>${esc(p.heading)}</h2>
  ${(p.records ?? []).map((r) => `<div class="lg-row"><div class="lg-no">${esc(r.no)}</div>
    <div><h3>${esc(r.name)}<small>${esc(r.en)}</small></h3><p>${esc(r.note)}</p></div>
    <div class="lg-st">${(r.stats ?? []).map(([k, v]) => `${esc(k)} <b>${esc(v)}</b>`).join('<br>')}</div></div>`).join('')}</section>`,
      css: `.sc-ledger { padding:14vh clamp(22px,7vw,110px); background:linear-gradient(180deg,transparent,rgba(0,0,0,.25)); }
.lg-kick { font:400 10px/1 ui-monospace,monospace; letter-spacing:.5em; color:${esc(p.accent ?? '#4de8b4')}; margin-bottom:3vh; }
.sc-ledger h2 { font-weight:500; font-size:clamp(26px,4vw,46px); letter-spacing:.14em; margin-bottom:6vh; color:${esc(p.ink ?? '#dbe9f2')}; }
.lg-row { display:grid; grid-template-columns:110px 1fr 210px; gap:clamp(14px,3vw,40px); padding:26px 0; border-top:1px solid rgba(219,233,242,.12); align-items:baseline; }
.lg-row:last-child { border-bottom:1px solid rgba(219,233,242,.12); }
.lg-no { font:400 12px/1 ui-monospace,monospace; color:rgba(219,233,242,.5); letter-spacing:.14em; }
.lg-row h3 { font-weight:400; font-size:clamp(17px,2vw,24px); letter-spacing:.16em; color:${esc(p.ink ?? '#dbe9f2')}; margin:0; }
.lg-row h3 small { font:300 10px/1 ui-monospace,monospace; letter-spacing:.24em; color:rgba(219,233,242,.45); margin-left:12px; }
.lg-row p { margin:8px 0 0; font-size:13px; line-height:2.05; color:rgba(219,233,242,.74); max-width:56ch; }
.lg-st { font:400 10px/2 ui-monospace,monospace; letter-spacing:.16em; color:rgba(219,233,242,.5); text-align:right; }
.lg-st b { color:${esc(p.accent ?? '#4de8b4')}; font-weight:500; }
@media (max-width:760px){ .lg-row{grid-template-columns:1fr;gap:8px} .lg-st{text-align:left} }`,
      js: '',
    };
    case 'ledgerClose': return {
      html: `<section class="sc-${id} sc-close" id="${id}"><div class="close-floor"></div><div class="close-body">
  <h2>${esc(p.heading)}</h2><p>${esc(p.note)}</p>
  <a class="close-cta" href="#" onclick="scrollTo({top:0,behavior:'smooth'});return false;">${esc(p.cta)}</a>
  <div class="close-fin">${esc(p.foot ?? '')}</div></div></section>`,
      css: `.sc-close { min-height:100vh; display:grid; place-content:center; text-align:center; padding:18vh 22px; position:relative; overflow:hidden; background:linear-gradient(180deg,transparent,#02050 7); background:linear-gradient(180deg,transparent,rgba(0,0,0,.3)); }
.close-floor { position:absolute; left:0; right:0; bottom:0; height:190px; background:radial-gradient(ellipse at 50% 100%, rgba(10,16,22,.8) 0%, transparent 72%); }
.close-floor::after { content:''; position:absolute; left:8%; right:8%; bottom:0; height:60px; background:linear-gradient(180deg, transparent, rgba(4,8,12,.9) 40%); clip-path:polygon(0 100%,4% 62%,12% 78%,22% 40%,30% 66%,43% 30%,55% 58%,66% 38%,78% 70%,88% 46%,96% 68%,100% 100%); }
.sc-close h2 { font-weight:300; font-size:clamp(30px,4.6vw,54px); letter-spacing:.4em; text-indent:.4em; color:${esc(p.ink ?? '#dbe9f2')}; margin:0; }
.sc-close p { margin-top:3vh; font-size:13.5px; color:rgba(219,233,242,.6); letter-spacing:.12em; }
.close-cta { display:inline-block; margin-top:5vh; padding:16px 44px; border:1px solid ${esc(p.accent ?? '#4de8b4')}; color:${esc(p.accent ?? '#4de8b4')}; text-decoration:none; font:400 12px/1 ui-monospace,monospace; letter-spacing:.4em; animation:closeGlow 3.2s infinite; }
@keyframes closeGlow { 50% { box-shadow:0 0 40px ${esc(p.accent ?? '#4de8b4')}55; } }
.close-fin { margin-top:7vh; font:400 9.5px/1.9 ui-monospace,monospace; letter-spacing:.3em; color:rgba(219,233,242,.3); }
@media (prefers-reduced-motion:reduce){ .close-cta{animation:none} }`,
      js: '',
    };
    default: throw new Error(`未知能力：${scene.capability}`);
  }
}

/* ================= 能力 JS 实现（参数化） ================= */
function CINE_JS(p) {
  return `
(() => {
  const cv = document.querySelector('.cine-cv');
  const ctx = cv.getContext('2d');
  const BEAM = '${p.beamColor ?? 'rgba(120,190,235,'}', DUST = '${p.dustColor ?? 'rgba(205,225,240,'}';
  const BGT = '${p.bgTop ?? '#0a1a26'}', BGB = '${p.bgBottom ?? '#01040a'}';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W, H, dpr = Math.min(devicePixelRatio || 1, 2);
  const resize = () => { W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr,0,0,dpr,0,0); };
  resize(); addEventListener('resize', resize);
  const snow = Array.from({ length: 150 }, (_, i) => { const a = Math.sin(i*12.9898)*43758.5453, b = Math.sin(i*78.233)*12345.6789;
    return { x:(a-Math.floor(a))*2000, y:(b-Math.floor(b))*1200, z:.25+((a+b)%1+1)%1*.75, r:.4+(b-Math.floor(b))*1.4 }; });
  (function frame(t) {
    const sc = cv.closest('.sc-cine').getBoundingClientRect();
    const depth = Math.max(0, -sc.top) / 8;
    const light = Math.max(0, Math.exp(-depth / 240));
    const g = ctx.createLinearGradient(0,0,0,H);
    g.addColorStop(0, BGT); g.addColorStop(1, BGB);
    ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
    if (light > .05) { ctx.save(); ctx.globalCompositeOperation = 'screen';
      for (let i = 0; i < 5; i++) { const bx = W*(.12+i*.2)+Math.sin(t/4200+i*1.7)*50, sw = Math.sin(t/3600+i)*80;
        const gr = ctx.createLinearGradient(bx,-80,bx+sw,H);
        gr.addColorStop(0, 'rgba(120,190,235,'+(0.15*light)+')'); gr.addColorStop(.6,'rgba(90,160,215,'+(0.06*light)+')'); gr.addColorStop(1,'rgba(60,120,180,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(bx-36-i*12,-60); ctx.lineTo(bx+36+i*12,-60);
        ctx.lineTo(bx+sw+140+i*50,H+40); ctx.lineTo(bx+sw-140-i*50,H+40); ctx.closePath(); ctx.fill(); }
      ctx.restore(); }
    for (const s of snow) { const px = s.x % 2000 - 200; if (px < -4 || px > W+4) continue;
      const py = (s.y + (reduced ? 0 : t*.008*s.z)) % 1200; if (py > H) continue;
      ctx.fillStyle = DUST + (0.1+s.z*.26) + ')'; ctx.beginPath(); ctx.arc(px,py,s.r*s.z,0,6.2832); ctx.fill(); }
    requestAnimationFrame(frame);
  })(0);
})();`;
}
function PRESS_JS(p, id) {
  return `
(() => {
  const sec = document.getElementById('${id}');
  const h = sec.querySelector('.press-h'), meta = sec.querySelector('.press-meta');
  const stages = ${JSON.stringify(p.stages ?? [])};
  const FROM = ${JSON.stringify(p.from ?? { spacing: .34, weight: 200 })}, TO = ${JSON.stringify(p.to ?? { spacing: .02, weight: 700 })};
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function upd() { const r = sec.getBoundingClientRect();
    const f = reduced ? 1 : Math.min(1, Math.max(0, -r.top / (r.height - innerHeight)));
    h.style.letterSpacing = (FROM.spacing - f*(FROM.spacing-TO.spacing)) + 'em';
    h.style.fontWeight = String(Math.round(FROM.weight + f*(TO.weight-FROM.weight)));
    h.textContent = stages[Math.min(stages.length - 1, Math.floor(f * stages.length))] ?? stages[0];
    meta.textContent = '${esc(p.meta ?? '')} ' + Math.round(f*100) + '%';
  }
  addEventListener('scroll', upd, { passive: true }); upd();
})();`;
}
function FLOW_JS(p, id) {
  return `
(() => {
  const sec = document.getElementById('${id}');
  const cv = sec.querySelector('.flow-cv');
  const gl = cv.getContext('webgl', { antialias: false });
  if (!gl) { cv.outerHTML = '<div style="position:absolute;inset:0;display:grid;place-content:center;color:rgba(220,235,240,.5);font:400 11px/1 ui-monospace,monospace;letter-spacing:.3em">WEBGL 不可用 · 静态观测模式</div>'; return; }
  const N = Math.min(20000, ${p.count ?? 12000}), DIM = '${p.dim ?? '0.24,0.55,0.5'}', LIT = '${p.lit ?? '0.42,1.0,0.78'}';
  const VS = 'attribute vec3 aSeed;uniform float uT;uniform vec2 uM;uniform vec2 uR;uniform float uE;varying float vG;vec2 fl(vec2 p,float t){return vec2(sin(p.y*2.1+t*.21)+cos(p.x*1.7-t*.13),sin(p.x*2.6-t*.17)+cos(p.y*2.2+t*.11))*22.;}void main(){vec2 p=vec2(aSeed.x*uR.x,aSeed.y*uR.y);float l=fract(aSeed.z+uT*(.01+aSeed.z*.012));for(int i=0;i<4;i++)p+=fl(p*.004,uT)*.016;vec2 d=p-uM;float s=exp(-length(d)*.011)*uE;p+=normalize(d+.001)*s*90.+vec2(-d.y,d.x)*s*.5;p=mod(p,uR);float fk=.35+.65*pow(sin(l*6.2832+aSeed.z*40.)*.5+.5,3.);vG=clamp(s*2.4+fk*.42,.06,1.);gl_Position=vec4((p/uR)*2.-1.,0.,1.);gl_PointSize=(2.+aSeed.z*2.6)*(1.+vG*1.8)*uR.y/900.*1.8;}';
  const FS = 'precision mediump float;varying float vG;void main(){vec2 c=gl_PointCoord-.5;float d=length(c);float co=smoothstep(.5,.05,d);vec3 col=mix(vec3(${p.dim ?? '0.24,0.55,0.5'})*.5,vec3(${p.lit ?? '0.42,1.0,0.78'}),min(1.,vG*1.15));gl_FragColor=vec4(col,co*(.25+vG*.75));if(gl_FragColor.a<.02)discard;}';
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
  const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  const seeds = new Float32Array(N * 3); for (let i = 0; i < N * 3; i++) seeds[i] = Math.random();
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
  const a = gl.getAttribLocation(pr, 'aSeed'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 3, gl.FLOAT, false, 0, 0);
  const u = { t: gl.getUniformLocation(pr,'uT'), m: gl.getUniformLocation(pr,'uM'), r: gl.getUniformLocation(pr,'uR'), e: gl.getUniformLocation(pr,'uE') };
  let mx = -9e3, my = -9e3, en = 0, tEn = 0, last = 0, run = false, t0 = performance.now();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  addEventListener('pointermove', (e) => { mx = e.clientX; my = e.clientY; tEn = 1; last = performance.now(); });
  const sz = () => { const r = cv.getBoundingClientRect(); if (!r.width) return; cv.width = r.width * dpr; cv.height = r.height * dpr; gl.viewport(0, 0, cv.width, cv.height); };
  addEventListener('resize', sz);
  new IntersectionObserver((es) => { run = es[0].isIntersecting; }, { threshold: .05 }).observe(sec);
  (function fr(ts) { requestAnimationFrame(fr); if (!run) return; sz();
    en += (tEn - en) * .035; if (ts - last > 4200) tEn = Math.max(0, tEn - .012);
    const r = cv.getBoundingClientRect();
    gl.uniform1f(u.t, reduced ? 20 : (ts - t0) / 1000); gl.uniform2f(u.m, mx - r.left, my - r.top); gl.uniform2f(u.r, r.width, r.height); gl.uniform1f(u.e, en);
    gl.clearColor(.004, .031, .039, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.POINTS, 0, N);
  })(t0);
})();`;
}
function PROD_JS(p, id) {
  return `
(() => {
  const cv = document.querySelector('#${id} .prod-cv'); const ctx = cv.getContext('2d');
  const ACC = '${p.accent ?? '#7fd8ff'}'; const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let rotY = 0.6, vy = reduced ? 0 : 0.0022;
  const specCount = ${(p.specs ?? []).length};
  let hover = -1;
  function draw(t) {
    if (!reduced) rotY += vy;
    const S = cv.width, cx = S/2, cy = S/2;
    ctx.clearRect(0, 0, S, S);
    const R = S * 0.3;
    for (let face = 0; face < 6; face++) {
      const a0 = rotY + face * Math.PI / 3;
      const depth = Math.cos(a0);
      const x = cx + Math.sin(a0) * R * 1.35;
      const w = R * 0.62 * Math.abs(Math.sin(a0)) + 14;
      const alpha = 0.35 + 0.45 * Math.max(0, depth);
      const hl = face === hover;
      ctx.fillStyle = hl ? ACC : 'rgba(140,165,190,' + alpha.toFixed(2) + ')';
      ctx.fillRect(x - w/2, cy - R*0.9, w, R*1.8);
      ctx.strokeStyle = hl ? ACC : 'rgba(200,220,240,.28)'; ctx.lineWidth = hl ? 2 : 1;
      ctx.strokeRect(x - w/2, cy - R*0.9, w, R*1.8);
    }
    const gl2 = ctx.createRadialGradient(cx, cy, R*.2, cx, cy, R*1.9);
    gl2.addColorStop(0, ACC + '30'); gl2.addColorStop(1, 'transparent');
    ctx.fillStyle = gl2; ctx.fillRect(0, 0, S, S);
    ctx.font = '400 10px ui-monospace,monospace'; ctx.fillStyle = 'rgba(200,220,240,.5)'; ctx.textAlign = 'center';
    ctx.fillText('DRAG TO ROTATE · ' + Math.round((rotY % 6.2832 / 6.2832) * 360) + '°', cx, S - 14);
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
  let drag = false, lx = 0;
  cv.addEventListener('pointerdown', (e) => { drag = true; lx = e.clientX; });
  addEventListener('pointermove', (e) => { if (drag) { vy = (e.clientX - lx) * .0004; lx = e.clientX; }
    const r = cv.getBoundingClientRect(); const mx = e.clientX - r.left;
    hover = Math.floor((mx / r.width) * 6); });
  addEventListener('pointerup', () => { drag = false; });
})();`;
}

/* ================= 转场代码生成（滚动驱动交叉区） ================= */
export function renderTransition(tr, sceneA, sceneB) {
  const kind = tr?.mechanism ?? 'depthPush';
  const mid = `tr-${sceneA.id}-${sceneB.id}`;
  const common = `.tr { position:relative; height:150vh; }`; /* 转场行程须大于视口高，进度分母为正、行程充足 */
  switch (kind) {
    case 'decomposeGrid': {
      const phrase = tr.params?.fromPhrase ?? '';
      const chars = [...phrase].filter((c) => c.trim());
      return { css: `${common}
.#${mid} .dg-chars { position:sticky; top:0; height:100vh; display:flex; align-items:center; justify-content:center; gap:.4em; }
.#${mid} .dg-chars span { font:300 clamp(40px,7vw,90px)/1 Georgia,serif; color:${tr.params?.color ?? '#e6eff5'}; will-change:transform,opacity; }
.#${mid} { background:#05070a; }`,
        js: `(() => { const zone = document.querySelector('#${mid}'); const chs = [...zone.querySelectorAll('span')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function upd() { const r = zone.getBoundingClientRect(); const f = reduced ? 1 : Math.min(1, Math.max(0, -r.top / (r.height - innerHeight)));
    chs.forEach((c, i) => { const lf = Math.min(1, Math.max(0, (f - i * .06) / .5));
      const ang = (i * 47) % 360;
      c.style.transform = 'translate(' + (lf * ((i % 3) - 1) * 30) + 'vw,' + (lf * (i % 2 ? 42 : -38)) + 'vh) rotate(' + (lf * (i - chs.length / 2) * 9) + 'deg)';
      c.style.opacity = String(1 - lf); c.style.color = 'hsl(' + ang + ' 40% ' + (72 - lf * 30) + '%)'; }); }
  addEventListener('scroll', upd, { passive: true }); upd(); })();`,
        html: `<div class="tr" id="${mid}"><div class="dg-chars">${chars.map((c) => `<span>${c}</span>`).join('')}</div></div>` };
    }
    case 'inkExpand': {
      return { css: `${common}
.#${mid} .ink { position:sticky; top:0; height:100vh; background:${tr.params?.color ?? '#020507'}; clip-path:circle(0% at 50% 55%); will-change:clip-path; }
.#${mid} .ink::after { content:'${(tr.params?.word ?? '').replace(/'/g, '')}'; position:absolute; inset:0; display:grid; place-content:center; font:300 clamp(28px,4.4vw,58px)/1 Georgia,serif; letter-spacing:.5em; color:rgba(235,242,246,.85); }`,
        js: `(() => { const z = document.querySelector('#${mid} .ink');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function upd() { const r = z.parentElement.getBoundingClientRect(); const f = reduced ? 1 : Math.min(1, Math.max(0, -r.top / (r.height - innerHeight)));
    z.style.clipPath = 'circle(' + (f * 90) + '% at 50% 55%)'; }
  addEventListener('scroll', upd, { passive: true }); upd(); })();`,
        html: `<div class="tr" id="${mid}"><div class="ink"></div></div>` };
    }
    case 'letterformHandoff': {
      return { css: `${common}
.#${mid} { overflow:hidden; background:transparent; }
.#${mid} .lf { position:sticky; top:0; height:100vh; display:grid; place-items:center; }
.#${mid} .lf span { font:700 clamp(200px,46vw,560px)/1 Georgia,serif; color:${tr.params?.color ?? '#e6eff5'}; opacity:.07; transform:scale(.4); will-change:transform,opacity; }`,
        js: `(() => { const z = document.querySelector('#${mid} .lf span');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function upd() { const r = z.closest('.tr').getBoundingClientRect(); const f = reduced ? 1 : Math.min(1, Math.max(0, -r.top / (r.height - innerHeight)));
    z.style.transform = 'scale(' + (.4 + f * 1.5) + ')'; z.style.opacity = String(.07 + f * .16); }
  addEventListener('scroll', upd, { passive: true }); upd(); })();`,
        html: `<div class="tr" id="${mid}"><div class="lf"><span>${(tr.params?.glyph ?? '境')}</span></div></div>` };
    }
    default: { // depthPush
      return { css: `${common}
.#${mid} .dp { position:sticky; top:0; height:100vh; display:grid; place-items:center; background:${tr.params?.bg ?? '#05070a'}; }
.#${mid} .dp span { font:300 clamp(15px,2vw,24px)/2 ui-monospace,monospace; letter-spacing:.6em; color:rgba(220,235,245,.7); transform:scale(.86); filter:blur(8px); opacity:0; will-change:transform,filter,opacity; }`,
        js: `(() => { const z = document.querySelector('#${mid} .dp span');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function upd() { const r = z.closest('.tr').getBoundingClientRect(); const f = reduced ? 1 : Math.min(1, Math.max(0, -r.top / (r.height - innerHeight)));
    z.style.transform = 'scale(' + (.86 + f * .14) + ')'; z.style.filter = 'blur(' + (8 - f * 8) + 'px)'; z.style.opacity = String(f); }
  addEventListener('scroll', upd, { passive: true }); upd(); })();`,
        html: `<div class="tr" id="${mid}"><div class="dp"><span>${(tr.params?.word ?? '推近')/*.  */}</span></div></div>` };
    }
  }
}
