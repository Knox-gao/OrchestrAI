/**
 * Breakthrough：一句话→完整网站 端到端实验
 * 核心策略：单次调用产全栈代码（解决上轮"跨调用 DOM 契约"问题），
 * 分两步：①概念+页面结构（轻量 JSON）②全栈单文件代码（一次输出完整 HTML+CSS+JS）
 * 反馈闭环：Edge headless 渲染→丰富探针→LLM 诊断→定向修复→重渲染
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const { getKeys } = await import(pathToFileURL(path.join(ROOT, 'apps/server/keys.mjs')).href);

const REQ = `为一个高端户外露营品牌设计并实现一套令人印象深刻的官网。面向热爱自然、重视品质的年轻人。希望网站具有电影般的视觉表现、独特的品牌表达、丰富但有节奏的浏览体验，以及完整可操作的营地探索和预约流程。请自主决定创意概念、视觉语言、页面结构、素材策略、技术方案和交互方式，交付可运行的网站。`;

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

function extractFullPage(text) {
  // 宽松提取：找完整 HTML 文档（含 <!DOCTYPE 或 <html）
  let start = text.indexOf('<!DOCTYPE') !== -1 ? text.indexOf('<!DOCTYPE') : text.indexOf('<!doctype');
  if (start === -1) start = text.indexOf('<html');
  if (start === -1) start = text.indexOf('<body');
  const end = text.lastIndexOf('</html>');
  if (start !== -1 && end > start) return text.slice(start, end + 7);
  // 兜底：从第一个 < 到最后一个 >
  const f = text.indexOf('<'); const l = text.lastIndexOf('>');
  return f !== -1 && l > f ? text.slice(f, l + 1) : '';
}

const log = { calls: [], rounds: [] };
const outDir = path.join(HERE, 'out');
fs.mkdirSync(outDir, { recursive: true });

/* ============ 步骤 1：创意规划（轻量，不产代码） ============ */
console.log('=== 步骤 1：创意规划 ===');
const P = await chat(
  `你是创意总监。用一句话回答你的核心创意概念，然后列出页面结构（每页一行，格式：页面名 | 核心任务 | 视觉关键词）。不超过 10 行。`,
  REQ, 2000, 0.8,
);
log.calls.push({ step: 'plan', ms: P.ms, tokens: P.tokens });
console.log(P.text.slice(0, 300));
fs.writeFileSync(path.join(outDir, 'creative-brief.txt'), P.text);

/* ============ 步骤 2：全栈单文件生成（一次输出完整可运行页面） ============ */
console.log('\n=== 步骤 2：全栈代码生成 ===');
const CODE_SYS = `你是顶尖创意技术工程师。根据需求和创意方案，生成一个完整的单文件 HTML 页面（含 <!DOCTYPE> 到 </html>，内嵌全部 CSS 和 JS）。

关键要求：
1. 输出完整的可运行 HTML 文档，从 <!DOCTYPE html> 开始到 </html> 结束
2. 所有 CSS 写在 <style> 内，所有 JS 写在 <script> 内（不是 module，用普通 script + IIFE）
3. 页面是 SPA hash 路由（多个 <section data-page="xxx"> 切换 display）
4. 所有 input/select/button 必须有 class 和 label
5. 交互必须真实生效（导航切换、表单验证、价格计算、提交状态）
6. 移动端 @media(max-width:768px) 响应式
7. 中文文案具体可信，不要占位文字
8. 视觉要电影级——大胆用色彩/排印/空间，但服务于内容
9. 只输出代码，从 <!DOCTYPE 开始，不要任何解释或围栏标记

需求：${REQ}

创意方案：
${P.text}

直接输出完整 HTML 文档。`;

const C = await chat(CODE_SYS, REQ, 8000, 0.7);
log.calls.push({ step: 'codegen', ms: C.ms, tokens: C.tokens, outputLen: C.text.length });
const page = extractFullPage(C.text);
console.log(`产出: ${page.length} 字符 | ${C.ms}ms ${C.tokens} tokens`);
if (page.length < 5000) {
  console.log('⚠ 输出过短，可能被截断。前200字:', C.text.slice(0, 200));
}
fs.writeFileSync(path.join(outDir, 'index.html'), page);
fs.writeFileSync(path.join(outDir, 'index-v1.html'), page);

/* ============ 步骤 3：浏览器验收 + 反馈闭环 ============ */
for (let round = 1; round <= 3; round++) {
  console.log(`\n=== 第 ${round} 轮浏览器验收 ===`);
  const probe = await browserCheck(outDir);
  if (!probe) { console.log('浏览器检测失败'); break; }
  log.rounds.push({ round, probe });

  // 自动化检查
  const autoIssues = [];
  if (probe.bareInputs > 0) autoIssues.push({ sev: 'med', desc: `${probe.bareInputs} 个裸 input` });
  if (probe.overflowX) autoIssues.push({ sev: 'high', desc: '横向溢出' });
  if (probe.errors.length > 0) autoIssues.push({ sev: 'high', desc: `控制台错误: ${probe.errors.join('; ')}` });
  if (probe.sections < 3) autoIssues.push({ sev: 'high', desc: `sections 仅 ${probe.sections}` });
  if (probe.noJS) autoIssues.push({ sev: 'high', desc: 'JS 未执行' });

  // LLM 视觉诊断（传丰富探针）
  const D = await chat(
    `你是视觉+功能审查师。根据浏览器探针数据列出问题。只输出 JSON 数组 [{"sev":"","level":"","area":"","desc":"","fix":""}]。最多 5 个最关键问题。`,
    JSON.stringify(probe).slice(0, 4000), 2000, 0.5,
  );
  let llmIssues = [];
  try { llmIssues = JSON.parse(D.text.slice(D.text.indexOf('['), D.text.lastIndexOf(']') + 1)); } catch {}
  log.calls.push({ step: `diagnose:${round}`, ms: D.ms, tokens: D.tokens, issues: llmIssues.length + autoIssues.length });

  const allIssues = [...autoIssues, ...llmIssues];
  console.log(`问题: 自动 ${autoIssues.length} + LLM ${llmIssues.length}`);
  for (const i of allIssues) console.log(`  ${i.sev} [${i.area ?? 'auto'}] ${i.desc?.slice(0, 60)}`);

  if (allIssues.length === 0) { console.log('✓ 无问题，完成'); break; }

  // 修复：把问题反馈给 LLM 定向修补
  console.log(`--- 修复 ---`);
  const FIX_SYS = `你是代码修复师。根据问题清单，输出修复后的完整 HTML 文档（与原版结构相同，只修改问题相关部分）。从 <!DOCTYPE html> 到 </html> 完整输出。不要解释。
问题：
${allIssues.map((i, n) => `${n + 1}. [${i.sev}] ${i.desc} → ${i.fix ?? '修复此问题'}`).join('\n')}`;

  const F = await chat(FIX_SYS, '修复以上问题', 8000, 0.5);
  const fixed = extractFullPage(F.text);
  log.calls.push({ step: `fix:${round}`, ms: F.ms, tokens: F.tokens, outputLen: fixed.length });
  if (fixed.length > 3000) {
    fs.writeFileSync(path.join(outDir, `index-v${round + 1}-before.html`), fs.readFileSync(path.join(outDir, 'index.html'), 'utf8'));
    fs.writeFileSync(path.join(outDir, 'index.html'), fixed);
    console.log(`修复: ${fixed.length} 字符`);
  } else {
    console.log(`⚠ 修复输出过短 ${fixed.length}，跳过`);
    break;
  }
}

/* ============ 终验 ============ */
console.log('\n=== 终验 ===');
const finalProbe = await browserCheck(outDir);
if (finalProbe) {
  log.final = finalProbe;
  console.log(`sections: ${finalProbe.sections} | h1: ${finalProbe.h1?.slice(0, 30)} | inputs: ${finalProbe.inputs} | bare: ${finalProbe.bareInputs} | overflow: ${finalProbe.overflowX} | errors: ${finalProbe.errors.length} | nav: ${finalProbe.nav} | pages: ${finalProbe.pages?.length}`);
}

fs.writeFileSync(path.join(outDir, 'breakthrough-log.json'), JSON.stringify(log, null, 1));
const totalCalls = log.calls.length;
const totalMs = log.calls.reduce((a, c) => a + c.ms, 0);
const totalTokens = log.calls.reduce((a, c) => a + (c.tokens ?? 0), 0);
console.log(`\n=== 统计 === ${totalCalls} 次调用 | ${Math.round(totalMs / 1000)}s | ${totalTokens} tokens`);

/* 浏览器检测 */
async function browserCheck(dir) {
  return new Promise((resolve) => {
    const PROBE = `(() => {
      const d = {};
      d.sections = document.querySelectorAll('section,[data-page]').length;
      d.pages = [...document.querySelectorAll('[data-page]')].map((s) => s.dataset.page);
      d.h1 = document.querySelector('h1')?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 50) ?? 'none';
      d.h2Count = document.querySelectorAll('h2').length;
      d.nav = !!document.querySelector('nav');
      d.navLinks = document.querySelectorAll('nav a').length;
      d.inputs = document.querySelectorAll('input,select').length;
      d.bareInputs = [...document.querySelectorAll('input:not([class])')].length;
      d.buttons = document.querySelectorAll('button').length;
      d.interactive = d.inputs + d.buttons;
      d.canvas = document.querySelectorAll('canvas').length;
      d.svg = document.querySelectorAll('svg').length;
      d.pageH = document.documentElement.scrollHeight;
      d.overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
      d.noJS = typeof window.__jsRan === 'undefined' && document.querySelectorAll('[onclick]').length === 0;
      d.errors = window.__errs ?? [];
      // 表单
      const form = document.querySelector('form');
      d.form = form ? { inputs: form.querySelectorAll('input,select').length, buttons: form.querySelectorAll('button').length } : null;
      return d;
    })()`;
    const probeTag = `<script>window.__errs=[];window.onerror=(m)=>{window.__errs.push(m)};</script>`;
    let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    html = html.replace('</head>', probeTag + '</head>');
    // 注入 JS 执行标记
    html = html.replace('</body>', `<script>window.__jsRan=true;</script></body>`);
    const tmp = path.join(dir, '_probe.html');
    fs.writeFileSync(tmp, html);
    execFile('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      ['--headless=new', '--disable-gpu', '--dump-dom', '--virtual-time-budget=10000', 'file:///' + tmp.replaceAll('\\', '/')],
      { timeout: 30_000, maxBuffer: 30e6 }, (e, stdout) => {
        try { fs.unlinkSync(tmp); } catch {}
        if (e || !stdout) return resolve(null);
        // 从 DOM 中提取 JSON（title 不可靠——用 script 内容标记）
        const m = stdout.match(/window\.__probeData\s*=\s*(\{[\s\S]*?\});/);
        if (m) { try { resolve(JSON.parse(m[1])); return; } catch {} }
        resolve({ sections: (stdout.match(/<section/g) || []).length, raw: stdout.length, errors: ['probe_parse_failed'] });
      });
    // 在页面中注入数据收集
    html = html.replace('<script>window.__jsRan=true;</script>',
      `<script>window.__jsRan=true;try{document.title='P'+JSON.stringify(eval(${JSON.stringify(PROBE)}))}catch(e){}</script>`);
    fs.writeFileSync(tmp, html);
  });
}
