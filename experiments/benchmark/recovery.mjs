/**
 * Creative Quality Recovery — 潮汐露营单作品彻底重设计
 * 步骤：修提取协议 → 完整性检测 → 丰富探针 → 创作诊断 → 允许整体重设计 → 重新实现 → 两轮反馈闭环
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const { getKeys } = await import(pathToFileURL(path.join(ROOT, 'apps/server/keys.mjs')).href);

async function chat(sys, usr, maxTokens = 4000, temp = 0.6) {
  const key = getKeys().zhipu;
  const t0 = performance.now();
  const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'glm-5.3-flash', messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }], temperature: temp, max_tokens: maxTokens, thinking: { type: 'disabled' } }),
    signal: AbortSignal.timeout(180_000),
  });
  const j = await res.json();
  return { text: j.choices?.[0]?.message?.content ?? '', ms: Math.round(performance.now() - t0), tokens: j.usage?.total_tokens ?? null };
}

/* ============ 修复的代码提取 ============ */
export function extractBlocks(text) {
  const blocks = { html: '', css: '', js: '' };
  // 匹配所有围栏代码块，html/css/js/javascript 标签统一归一
  const re = /```(\w+)?\s*\n([\s\S]*?)```/g;
  for (const m of text.matchAll(re)) {
    const lang = (m[1] || '').toLowerCase();
    const code = m[2].trim();
    if (lang === 'html' || (!lang && code.includes('<'))) blocks.html += (blocks.html ? '\n' : '') + code;
    else if (lang === 'css' || (!lang && code.includes('{') && code.includes('}') && !code.includes('<'))) blocks.css += (blocks.css ? '\n' : '') + code;
    else if (lang === 'js' || lang === 'javascript' || lang === 'mjs' || (!lang && (code.includes('function') || code.includes('=>') || code.includes('document.')))) blocks.js += (blocks.js ? '\n' : '') + code;
  }
  // 兜底：无围栏但含 <section → 当 html
  if (!blocks.html && text.includes('<section')) {
    const start = text.indexOf('<section');
    const end = text.lastIndexOf('</section>');
    if (end > start) blocks.html = text.slice(start, end + 10);
  }
  return blocks;
}

/* ============ 完整性检测 ============ */
export function checkIntegrity(html) {
  const checks = {
    hasDoctype: html.includes('<!doctype') || html.includes('<!DOCTYPE'),
    hasViewport: html.includes('viewport'),
    hasStyle: html.includes('</style>'),
    hasScript: html.includes('</script>'),
    sectionCount: (html.match(/<section/g) || []).length,
    hasJS: html.includes('addEventListener') || html.includes('onclick') || html.includes('querySelector'),
    hasCanvas: html.includes('canvas'),
    hasSVG: html.includes('<svg'),
    hasForm: html.includes('<form'),
    hasInput: html.includes('<input'),
    hasButton: html.includes('<button'),
    jsIIFECount: (html.match(/\(\(\)\s*=>|;\s*\(\(\)\s*=>/g) || []).length,
    cssRuleCount: (html.match(/\{[^}]+\}/g) || []).length,
  };
  checks.ok = checks.hasStyle && checks.sectionCount >= 3 && checks.hasJS && checks.cssRuleCount > 20;
  checks.issues = [];
  if (!checks.hasJS) checks.issues.push('无 JavaScript');
  if (checks.sectionCount < 3) checks.issues.push(`section 仅 ${checks.sectionCount}`);
  if (checks.cssRuleCount < 20) checks.issues.push(`CSS 规则仅 ${checks.cssRuleCount}`);
  if (checks.jsIIFECount < 2) checks.issues.push(`JS IIFE 仅 ${checks.jsIIFECount}（交互可能未实现）`);
  return checks;
}

/* ============ 丰富探针（含计算样式+重叠+焦点） ============ */
export const RICH_PROBE = `(() => {
  const d = {};
  // 首屏焦点元素（面积排序 top 5）
  const els = [...document.querySelectorAll('section *')].filter((e) => {
    const r = e.getBoundingClientRect(); return r.height > 30 && r.width > 50;
  });
  d.focus = els.map((e) => {
    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return { tag: e.tagName, cls: e.className?.toString?.().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height),
      fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color, bg: cs.backgroundColor?.slice(0, 25), pos: cs.position, display: cs.display };
  }).sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 8);
  // 逐幕内容
  d.sections = [...document.querySelectorAll('section')].map((s, i) => {
    const r = s.getBoundingClientRect();
    const kids = [...s.children].map((c) => { const cr = c.getBoundingClientRect(); return { cls: c.className?.toString?.().slice(0, 30), w: Math.round(cr.width), h: Math.round(cr.height) }; });
    return { idx: i, cls: s.className?.slice(0, 30), h: Math.round(r.height), children: kids.slice(0, 5) };
  });
  // 排印
  const h1 = document.querySelector('h1'), h2s = [...document.querySelectorAll('h2')], ps = [...document.querySelectorAll('p')];
  d.typography = {
    h1: h1 ? { text: h1.textContent.slice(0, 30), size: getComputedStyle(h1).fontSize, weight: getComputedStyle(h1).fontWeight, ls: getComputedStyle(h1).letterSpacing } : null,
    h2Count: h2s.length, h2Sizes: h2s.map((h) => getComputedStyle(h).fontSize),
    pCount: ps.length, pSizes: ps.length ? [getComputedStyle(ps[0]).fontSize, getComputedStyle(ps[Math.floor(ps.length / 2)]).fontSize] : [],
  };
  // 交互
  d.forms = [...document.querySelectorAll('form')].map((f) => ({
    action: f.action || 'none', inputs: f.querySelectorAll('input,select,textarea').length, buttons: f.querySelectorAll('button').length,
    fieldNames: [...f.querySelectorAll('input,select')].map((i) => i.name || i.type || i.tagName).slice(0, 8),
  }));
  d.clickable = document.querySelectorAll('button,a[href^="#"],[onclick],[role=button]').length;
  // 画布/图形
  d.canvas = [...document.querySelectorAll('canvas')].map((c) => ({ w: c.width, h: c.height, cw: Math.round(c.getBoundingClientRect().width) }));
  d.svg = document.querySelectorAll('svg').length;
  // 布局异常
  d.overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
  d.pageH = document.documentElement.scrollHeight;
  d.consoleErrors = window.__errs || [];
  return d;
})()`;

/* ============ 主流程 ============ */
export async function recover(projectDir, reqBrief) {
  const log = { calls: [], rounds: [] };
  const outDir = path.join(HERE, 'out', path.basename(projectDir));

  /* 步骤 1：视觉诊断（用丰富探针） */
  console.log('=== 创作诊断 ===');
  const probeResult = await browserProbeRich(outDir);
  if (!probeResult) { console.log('探针失败'); return; }
  log.probe = probeResult;

  /* 步骤 2：LLM 创作诊断（传结构化视觉证据） */
  const diag = await chat(
    `你是产品设计师+视觉审查师。根据以下浏览器探针数据（来自真实页面），列出所有创作质量问题。
探针数据包含：视觉焦点元素（面积/样式）、各幕布局、排印层级、表单结构、画布/图形、布局异常。

只输出 JSON 数组，每项：
{"sev":"high|med|low","level":"局部修复|结构重构|概念重设计","area":"","desc":"具体问题描述","evidence":"探针数据中的证据","fix":"修改目标","verify":"验收方式"}

重点：首屏价值传达、视觉焦点清晰度、信息层级、表单决策顺序、空间意图、视觉语言一致性、依赖卡片堆叠、交互与任务匹配。
不关注"是否居中/是否有某装置/幕数"。`,
    `需求：${reqBrief}\n探针：${JSON.stringify(probeResult).slice(0, 5000)}`,
  );
  let issues;
  try { issues = JSON.parse(diag.text.slice(diag.text.indexOf('['), diag.text.lastIndexOf(']') + 1)); }
  catch { issues = []; }
  log.calls.push({ step: 'diagnosis', ms: diag.ms, tokens: diag.tokens, issues: issues.length });
  console.log(`诊断 ✓ ${diag.ms}ms | ${issues.length} 问题`);
  for (const i of issues) console.log(`  ${i.sev} [${i.level}] ${i.area}: ${i.desc?.slice(0, 60)}`);

  /* 步骤 3：重设计决策+实现 */
  const maxLevel = issues.reduce((a, i) => {
    const rank = { '局部修复': 0, '结构重构': 1, '概念重设计': 2 };
    return Math.max(a, rank[i.level] ?? 0);
  }, 0);
  const decision = ['局部修复', '结构重构', '概念重设计'][maxLevel];
  console.log(`修改级别决策: ${decision}`);

  if (decision === '概念重设计' || decision === '结构重构') {
    // 整体重设计：给 LLM 完整自由度重新生成
    console.log('=== 整体重设计 ===');
    const R = await chat(
      `你是独立创意技术总监。现有页面经诊断需要${decision}。请为需求产出一套全新创作方案并直接实现。
你可以：保留/修改/放弃潮汐概念、重新规划信息架构、重新组织预订流程、选择任意技术（Canvas/SVG/WebGL/CSS/真实图片）、删除无效装饰、从零实现交互组件。

需求：${reqBrief}

诊断问题：
${issues.map((i, n) => `${n + 1}. [${i.sev}] ${i.desc}`).join('\n')}

先输出方案 JSON（一行）：{"concept":"","identity":"","scenes":N}
然后依次输出 N 个代码块组合（每个组合包含 html 一个 section、css 该幕样式、javascript 该幕 JS，均用围栏代码块格式）。
每个幕独立实现，中文文案具体可信，交互真实生效。预订流程：选营地→选日期→填人数装备→确认（本地模拟，标注）。
输出完整收尾。`,
      reqBrief,
      4000, 0.7,
    );
    log.calls.push({ step: 'redesign', ms: R.ms, tokens: R.tokens });
    const blocks = extractBlocks(R.text);
    console.log(`重设计产出: html ${blocks.html.length} css ${blocks.css.length} js ${blocks.js.length}`);
    if (blocks.html) {
      const newHtml = assembleFull(blocks, '潮汐露营·重设计版');
      fs.writeFileSync(path.join(outDir, 'index-redesign.html'), newHtml);
      fs.copyFileSync(path.join(outDir, 'index.html'), path.join(outDir, 'index-v0-original.html'));
      fs.writeFileSync(path.join(outDir, 'index.html'), newHtml);
      console.log(`已写入 → ${outDir}/index.html`);
    }
  } else {
    // 局部修复：定向 CSS/JS 修复
    console.log('=== 定向修复 ===');
    const F = await chat(
      `根据问题清单只输出 \`\`\`css 和 \`\`\`javascript 围栏代码块。`,
      issues.map((i) => `[${i.sev}][${i.area}] ${i.desc} → ${i.fix}`).join('\n'),
    );
    const fp = extractBlocks(F.text);
    if (fp.css || fp.js) {
      let cur = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
      if (fp.css) cur = cur.replace('</style>', fp.css + '\n</style>');
      if (fp.js) cur = cur.replace('</script>\n</body>', fp.js + '\n</script>\n</body>');
      fs.writeFileSync(path.join(outDir, 'index.html'), cur);
    }
  }

  /* 步骤 4：第二轮（对重设计结果做精修） */
  console.log('=== 第二轮：精修 ===');
  const probe2 = await browserProbeRich(outDir);
  if (probe2) {
    const diag2 = await chat(
      `你是视觉审查师。根据探针数据列出剩余问题（只输出 JSON 数组，同前格式）。\n探针：${JSON.stringify(probe2).slice(0, 4000)}`,
      '检查修复后的页面质量',
    );
    let issues2;
    try { issues2 = JSON.parse(diag2.text.slice(diag2.text.indexOf('['), diag2.text.lastIndexOf(']') + 1)); }
    catch { issues2 = []; }
    log.calls.push({ step: 'critique2', ms: diag2.ms, tokens: diag2.tokens, issues: issues2.length });
    console.log(`二轮批评: ${issues2.length} 问题`);
    if (issues2.length > 0) {
      const F2 = await chat(
        `根据问题清单只输出 \`\`\`css 和 \`\`\`javascript 围栏代码块（覆盖修复）。\n${issues2.map((i) => `[${i.sev}][${i.area}] ${i.desc} → ${i.fix}`).join('\n')}`,
        '修复剩余问题',
      );
      const fp2 = extractBlocks(F2.text);
      if (fp2.css || fp2.js) {
        let cur = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
        if (fp2.css) cur = cur.replace('</style>', fp2.css + '\n</style>');
        if (fp2.js) cur = cur.replace('</script>\n</body>', fp2.js + '\n</script>\n</body>');
        fs.writeFileSync(path.join(outDir, 'index.html'), cur);
        console.log(`精修: css ${fp2.css?.length} + js ${fp2.js?.length}`);
      }
    }
  }

  // 终验完整性
  const finalHtml = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
  const integrity = checkIntegrity(finalHtml);
  log.integrity = integrity;
  fs.writeFileSync(path.join(outDir, 'recovery-log.json'), JSON.stringify(log, null, 1));
  console.log('=== 终验 ===');
  console.log(`完整性: ok=${integrity.ok} | sections=${integrity.sectionCount} IIFE=${integrity.jsIIFECount} CSS规则=${integrity.cssRuleCount}`);
  return { log, integrity };
}

function assembleFull(blocks, title) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@200;300;400;600;900&family=IBM+Plex+Mono:wght@300;400&display=swap" rel="stylesheet">
<style>
* { margin:0; box-sizing:border-box; }
html { scroll-behavior:smooth; }
body { background:#0a0f14; color:#e8e4dc; font-family:'Noto Serif SC',Georgia,serif; overflow-x:hidden; }
${blocks.css}
</style></head><body>
${blocks.html}
<script type="module">
${blocks.js}
</script></body></html>`;
}

async function browserProbeRich(outDir) {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve) => {
    const probe = `<script>window.__errs=[];window.onerror=(m)=>{window.__errs.push(m)};window.addEventListener('load',()=>setTimeout(()=>{try{document.title='PROBE::'+JSON.stringify(eval(${JSON.stringify(RICH_PROBE)}))}catch(e){document.title='PROBE::ERR:'+e.message}},2500));</script>`;
    let html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    html = html.replace('</head>', probe + '</head>');
    const tmp = path.join(outDir, '_probe.html');
    fs.writeFileSync(tmp, html);
    execFile('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      ['--headless=new', '--disable-gpu', '--dump-dom', '--virtual-time-budget=10000', 'file:///' + tmp.replaceAll('\\', '/')],
      { timeout: 30_000, maxBuffer: 20e6 }, (e, stdout) => {
        try { fs.unlinkSync(tmp); } catch {}
        if (e || !stdout) return resolve(null);
        const m = stdout.match(/PROBE::(\{[^<]*)/);
        resolve(m ? JSON.parse(m[1]) : null);
      });
  });
}

/* CLI */
const REQUIREMENTS = {
  c: {
    brief: '为小众露营地品牌「潮汐露营」做预订官网：展示 3 个营地（海边/森林/山谷）、每营地设施与价格、周末营位日历选择与在线预订表单（日期+人数+装备租借），目标是让用户 3 次点击内完成预订意向提交。目标用户是城市青年周末出行决策者。',
  },
};
if (process.argv[1]?.endsWith('recovery.mjs')) {
  const outDir = path.join(HERE, 'out', 'c');
  await recover(outDir, REQUIREMENTS.c.brief);
}
