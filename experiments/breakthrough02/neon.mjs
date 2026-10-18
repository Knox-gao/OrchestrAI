/**
 * Breakthrough 02：NEON / 城市脉搏 — 跨主题无模板化创作验证
 * 策略：单次全栈生成（上轮验证有效）+ 定向补丁修复（上轮教训：不重写全页）
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const { getKeys } = await import(pathToFileURL(path.join(ROOT, 'apps/server/keys.mjs')).href);

const REQ = `设计并实现一个名为 NEON / 城市脉搏的未来城市探索网站。用户能够探索一座虚构的未来城市，观察城市中不同区域的状态，发现交通、人流、天气或能源等城市信号，并通过交互理解城市如何变化。作品需要达到国际创意工作室的视觉表现水准，具有鲜明的原创概念、强烈的视觉焦点、丰富的信息层次、合理的浏览节奏和真实可用的交互。请自主决定具体概念、视觉语言、页面结构、内容组织、素材、技术栈和交互设计，交付完整可运行的作品。`;

async function chat(sys, usr, mt = 8000, temp = 0.7) {
  const key = getKeys().zhipu;
  const t0 = performance.now();
  const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'glm-5.3-flash', messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }], temperature: temp, max_tokens: mt, thinking: { type: 'disabled' } }),
    signal: AbortSignal.timeout(300_000),
  });
  const j = await res.json();
  return { text: j.choices?.[0]?.message?.content ?? '', ms: Math.round(performance.now() - t0), tokens: j.usage?.total_tokens ?? null };
}
function extractPage(text) {
  let s = text.search(/<!DOCTYPE/i); if (s === -1) s = text.search(/<html/i);
  if (s === -1) s = text.indexOf('<body'); if (s === -1) s = text.indexOf('<');
  const e = text.lastIndexOf('</html>'); const e2 = e !== -1 ? e + 7 : text.lastIndexOf('>');
  return s !== -1 && e2 > s ? text.slice(s, e2) : '';
}
function extractPatch(text) {
  const css = (text.match(/```css\n([\s\S]*?)```/) || [])[1]?.trim() ?? '';
  const js = (text.match(/```(?:javascript|js)\n([\s\S]*?)```/) || [])[1]?.trim() ?? '';
  return { css, js };
}

const log = { calls: [], rounds: [] };
const outDir = path.join(HERE, 'out');

/* ============ 步骤 1：单次全栈生成 ============ */
console.log('=== NEON / 城市脉搏：单次全栈生成 ===');
const SYS = `你是顶尖创意技术工程师+数字艺术家。根据需求生成一个完整的单文件 HTML 页面（从 <!DOCTYPE html> 到 </html>，内嵌全部 CSS 和 JS）。

硬性要求：
- 完整可运行：所有 JS 交互真实生效
- 城市 signal 可交互：点击/切换能改变可视化或数据展示
- 模拟数据内部一致，标注"虚构城市"
- 移动端 @media(max-width:768px) 响应式
- 所有 input/button 有 class 和 label
- 中文为主，数据/标签可英文
- 只输出代码，从 <!DOCTYPE 开始

创意完全由你决定。不要做仪表盘、不要做卡片网格、不要做标准 SaaS 布局。思考：城市是什么？信号如何可视化？用户如何探索？

需求：${REQ}`;

const C = await chat(SYS, REQ, 8000, 0.8);
const page = extractPage(C.text);
log.calls.push({ step: 'codegen', ms: C.ms, tokens: C.tokens, len: page.length });
console.log(`v1: ${page.length} 字符 | ${C.ms}ms | ${C.tokens} tokens`);
fs.writeFileSync(path.join(outDir, 'index.html'), page);
fs.writeFileSync(path.join(outDir, 'index-v1-immutable.html'), page);
if (page.length < 5000) console.log('⚠ 输出短（可能截断）');

/* ============ 步骤 2：浏览器验收+截图 ============ */
console.log('\n=== v1 浏览器验收 ===');
const probe = await browserProbe(outDir);
if (probe) {
  log.rounds.push({ round: 0, probe, type: 'v1-baseline' });
  console.log('探针:', JSON.stringify(probe).slice(0, 400));
}
await screenshot(outDir, 'v1');
console.log('v1 截图✓');

/* ============ 步骤 3：定向补丁迭代（≥2 轮，不重写全页） ============ */
for (let round = 1; round <= 2; round++) {
  console.log(`\n=== 第 ${round} 轮定向修复 ===`);
  const p = await browserProbe(outDir);
  if (!p) { console.log('探针失败'); break; }

  // 诊断
  const D = await chat(
    `你是视觉+功能审查师。根据浏览器探针数据列出最多 5 个最关键问题。只输出 JSON 数组 [{"sev":"","area":"","desc":"","fix":""}]。`,
    JSON.stringify(p).slice(0, 4000), 2000, 0.4,
  );
  let issues = [];
  try { issues = JSON.parse(D.text.slice(D.text.indexOf('['), D.text.lastIndexOf(']') + 1)); } catch {}
  log.calls.push({ step: `diag:${round}`, ms: D.ms, tokens: D.tokens, issues: issues.length });
  if (issues.length === 0) { console.log('✓ 无问题'); break; }
  console.log(`问题 ${issues.length} 个:`);
  for (const i of issues) console.log(`  ${i.sev} [${i.area}] ${i.desc?.slice(0, 60)}`);

  // 定向补丁（只产 CSS/JS patch，不重写全页）
  const FIX_SYS = `你是代码修复师。根据问题清单，只输出 \`\`\`css 和 \`\`\`javascript 两个围栏代码块（追加式补丁，不重写已有代码）。不要解释。
问题：
${issues.map((i, n) => `${n + 1}. [${i.sev}][${i.area}] ${i.desc} → ${i.fix}`).join('\n')}`;

  const F = await chat(FIX_SYS, '生成补丁', 3000, 0.4);
  const patch = extractPatch(F.text);
  log.calls.push({ step: `patch:${round}`, ms: F.ms, tokens: F.tokens, cssLen: patch.css.length, jsLen: patch.js.length });
  if (patch.css || patch.js) {
    let cur = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    // 版本存证
    fs.writeFileSync(path.join(outDir, `index-before-r${round}.html`), cur);
    if (patch.css) cur = cur.replace('</style>', patch.css + '\n</style>');
    if (patch.js) cur = cur.replace('</script>\n</body>', patch.js + '\n</script>\n</body>');
    fs.writeFileSync(path.join(outDir, 'index.html'), cur);
    console.log(`补丁: css ${patch.css.length} + js ${patch.js.length}`);
  }
  await screenshot(outDir, `r${round}`);
}

/* ============ 终验 ============ */
const finalProbe = await browserProbe(outDir);
await screenshot(outDir, 'final');
log.final = finalProbe;
fs.writeFileSync(path.join(outDir, 'log.json'), JSON.stringify(log, null, 1));
const totalMs = log.calls.reduce((a, c) => a + c.ms, 0);
const totalTk = log.calls.reduce((a, c) => a + (c.tokens ?? 0), 0);
console.log(`\n=== 统计 === ${log.calls.length} 调用 | ${Math.round(totalMs / 1000)}s | ${totalTk} tokens`);
if (finalProbe) console.log('终验:', JSON.stringify(finalProbe).slice(0, 300));

/* ============ 工具函数 ============ */
async function browserProbe(dir) {
  return new Promise((resolve) => {
    const PROBE = `(() => {
      const d = {};
      d.title = document.title;
      d.sections = document.querySelectorAll('section,[data-page]').length;
      d.h1 = document.querySelector('h1')?.textContent?.replace(/\\s+/g,' ').trim().slice(0,60) ?? 'none';
      d.h2s = [...document.querySelectorAll('h2')].map(h=>h.textContent.trim().slice(0,30)).slice(0,6);
      d.canvas = document.querySelectorAll('canvas').length;
      d.svg = document.querySelectorAll('svg').length;
      d.inputs = document.querySelectorAll('input,select').length;
      d.buttons = document.querySelectorAll('button').length;
      d.bareInputs = [...document.querySelectorAll('input:not([class])')].length;
      d.nav = !!document.querySelector('nav');
      d.navLinks = document.querySelectorAll('nav a').length;
      d.overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
      d.pageH = document.documentElement.scrollHeight;
      d.interactive = d.inputs + d.buttons + document.querySelectorAll('[onclick],[role=button]').length;
      return d;
    })()`;
    let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    const probeCode = `<script>window.__errs=[];window.onerror=m=>window.__errs.push(m);window.addEventListener('load',()=>setTimeout(()=>{try{const d=eval(${JSON.stringify(PROBE)});d.errors=window.__errs;const t=document.title;document.title='PROBE_'+JSON.stringify(d);setTimeout(()=>document.title=t,100)}catch(e){}},2000)));</script>`;
    html = html.replace('</head>', probeCode + '</head>');
    const tmp = path.join(dir, '_probe.html');
    fs.writeFileSync(tmp, html);
    execFile('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      ['--headless=new', '--disable-gpu', '--dump-dom', '--virtual-time-budget=10000', 'file:///' + tmp.replaceAll('\\', '/')],
      { timeout: 30_000, maxBuffer: 30e6 }, (e, stdout) => {
        try { fs.unlinkSync(tmp); } catch {}
        if (e || !stdout) return resolve(null);
        const m = stdout.match(/PROBE_(\{[^<]*)/);
        resolve(m ? JSON.parse(m[1]) : null);
      });
  });
}
async function screenshot(dir, name) {
  const shots = path.join(HERE, 'shots');
  fs.mkdirSync(shots, { recursive: true });
  return new Promise((resolve) => {
    execFile('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      ['--headless=new', '--disable-gpu', `--screenshot=${shots}\\${name}-desktop.png`, '--window-size=1440,900', '--virtual-time-budget=10000', 'file:///' + path.join(dir, 'index.html').replaceAll('\\', '/')],
      { timeout: 30_000 }, () => {
        execFile('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
          ['--headless=new', '--disable-gpu', `--screenshot=${shots}\\${name}-mobile.png`, '--window-size=390,844', '--virtual-time-budget=8000', 'file:///' + path.join(dir, 'index.html').replaceAll('\\', '/')],
          { timeout: 30_000 }, () => resolve());
      });
  });
}
