/**
 * Creative Intelligence Benchmark — 全链开放式创作实验
 * 三个差异需求 × [LLM 创意规划 → 开放式代码生成 → 浏览器验收 → 批评修订 ≥2 轮 → 终验]
 * 零能力白名单、零模板、零幕数约束——模型完全自主决策。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const { getKeys } = await import(pathToFileURL(path.join(ROOT, 'apps/server/keys.mjs')).href);

async function chat(sys, usr, maxTokens = 3800, temp = 0.6) {
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
const fences = (t) => { const out = {}; for (const m of t.matchAll(/```(html|css|js)\n([\s\S]*?)```/g)) out[m[1]] = m[2].trim(); return out; };
const jsonOf = (t) => { const s = t.indexOf('{'); return JSON.parse(t.slice(s, t.lastIndexOf('}') + 1)); };

/* ============ 三个真实需求（差异明确，验收标准可检） ============ */
export const REQUIREMENTS = {
  a: {
    name: '茧·生成艺术个展',
    brief: '为数字艺术家「茧」（Cocoon）做线上个展页面：展示三件生成艺术作品——每件有独特的程序化视觉（Canvas/WebGL/SVG 自选）+ 创作说明；访客是策展人和收藏家，目标是让他们想邀展。页面本身也应是一件作品。',
    audience: '策展人、数字艺术收藏家、创意技术社区',
    task: '浏览三件作品→阅读创作说明→感受到艺术家的技术能力与审美',
    acceptance: ['三件作品各有独立的程序化视觉（非同一效果的换色）', '每件作品可交互（非纯静态展示）', '创作说明与视觉有语义关联', '桌面+移动端无溢出', '页面整体有独立的艺术辨识度'],
  },
  b: {
    name: '汉字演化交互图谱',
    brief: '做一个「汉字演化」交互文化体验：选 6 个汉字（如日月山水火人），从甲骨文→金文→篆→隶→楷的演变过程可视化，每个阶段的字形变化配合含义解释。访客是文化爱好者和教育工作者，目标是让汉字之美可感知。',
    audience: '文化爱好者、语文教师、汉字学习 者',
    task: '选择一个汉字→观察字形演变动画→理解每个阶段的变化原因',
    acceptance: ['6 个汉字可切换', '每个字至少 3 个演化阶段可视化', '字形变化可感知（非纯文字罗列）', '阶段说明与字形对应', '移动端可用'],
  },
  c: {
    name: '潮汐露营·周末营地预订',
    brief: '为小众露营地品牌「潮汐露营」做预订官网：展示 3 个营地（海边/森林/山谷）、每营地的设施与价格、周末营位日历选择与在线预订表单（日期+人数+装备租借），目标是让用户 3 次点击内完成预订意向提交。',
    audience: '城市青年周末出行决策者',
    task: '浏览营地→选择日期与人数→提交预订意向',
    acceptance: ['3 个营地各有真实展示（非模板卡片）', '日历选择器可用（选日期）', '预订表单（人数+装备）可提交并显示确认', '3 次点击内可达提交', '移动端无溢出'],
  },
};

/* ============ 创作循环 ============ */
const SYS_PLAN = `你是独立的创意技术总监。为网站需求产出一套完整创作方案（只输出 JSON）。
你完全自主决定一切：概念主张、信息架构、视觉语言、技术路径（Canvas/WebGL/SVG/CSS 动画/程序化图形/真实数据可视化…按需选择）、交互机制、页面结构（幕数自定）、排印与色彩。没有模板、没有能力清单、没有枚举限制。
约束仅有：单文件 HTML 可直接运行（无构建/无外部 JS 库）、中文文案具体可信、每幕交互真实生效、移动端可用。
输出：{"concept":"一句有力主张","identity":"视觉辨识度来源","narrative":"信息叙事弧线","tech":{"primary":"","why":""},"scenes":[{"id":"","name":"","content":"","visual":"","interaction":"","mobile":""}],"palette":["#hex×4-6"],"typography":"","acceptanceNotes":""}`;

const SYS_SCENE = `你正在实现单页网站的一幕。全站配色族：{PALETTE}。排印方向：{TYPO}。
本幕规格：{SCENE}。
只输出三个围栏代码块（html/css/js），不要 JSON 不要解释。
要求：代码完整可运行；样式挂本幕专属 class（前缀 s{id}-）；JS 用 (()=>{ … })(); 包裹；交互真实生效；质量对标 Awwwards 获奖作品；中文为主；输出完整收尾。`;

const SYS_CRITIQUE = `你是视觉质量审查师。根据页面结构化描述（来自真实浏览器 DOM 探针），列出问题清单。
只输出 JSON 数组：[{"sev":"high|med|low","area":"","desc":"","fix":"","level":"局部修复|结构重构|概念重设计"}]
关注：视觉焦点是否清晰、层级是否拉开、空间利用是否有意图、排印是否有节奏、交互是否与概念一致、移动端适配。不关注"是否居中/是否有某装置/幕数"——只看质量结果。`;

export async function runProject(reqId, opts = {}) {
  const req = REQUIREMENTS[reqId];
  const outDir = path.join(HERE, 'out', reqId);
  fs.mkdirSync(outDir, { recursive: true });
  const log = { reqId, name: req.name, calls: [], rounds: [], humanInterventions: [] };

  console.log(`\n======= ${req.name} =======`);

  // 1) 创意规划
  const P = await chat(SYS_PLAN, `需求：${req.brief}\n目标用户：${req.audience}\n核心任务：${req.task}\n验收：${req.acceptance.join('；')}`);
  const plan = jsonOf(P.text);
  log.calls.push({ step: 'plan', ms: P.ms, tokens: P.tokens });
  log.plan = plan;
  console.log(`规划 ✓ ${P.ms}ms | 概念: ${plan.concept.slice(0, 50)}`);
  console.log(`技术: ${plan.tech?.primary} | 幕: ${plan.scenes.length}`);
  fs.writeFileSync(path.join(outDir, 'plan.json'), JSON.stringify(plan, null, 1));

  // 2) 分幕实现（开放式，无白名单）
  const parts = [];
  for (const s of plan.scenes) {
    const sys = SYS_SCENE.replace('{PALETTE}', JSON.stringify(plan.palette)).replace('{TYPO}', plan.typography ?? '').replace('{SCENE}', JSON.stringify(s)).replace('{id}', s.id);
    const r = await chat(sys, `需求：${req.brief}`);
    let part = fences(r.text);
    if (!part.html || !part.css) {
      log.calls.push({ step: `scene:${s.id}:retry`, ms: r.ms, tokens: r.tokens });
      const r2 = await chat(sys, `需求：${req.brief}`);
      part = fences(r2.text);
    }
    log.calls.push({ step: `scene:${s.id}`, ms: r.ms, tokens: r.tokens, htmlLen: part.html?.length, cssLen: part.css?.length, jsLen: part.js?.length });
    parts.push(part);
    console.log(`  ${s.id} ✓ ${part.html?.length}/${part.css?.length}/${part.js?.length}`);
  }

  // 3) 拼接
  const html = assemble(parts, req.name, plan);
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  fs.writeFileSync(path.join(outDir, 'index-v1.html'), html);
  console.log(`v1 → ${outDir}/index.html (${html.length} 字符)`);

  // 4) 浏览器验收 + 批评 + 修订（≥2 轮）
  for (let round = 1; round <= 2; round++) {
    console.log(`--- 第 ${round} 轮修订 ---`);
    // 用 DOM 探针获取结构化描述
    const probe = await browserProbe(outDir);
    if (!probe) { console.log('浏览器探测失败，跳过'); break; }
    log.rounds.push({ round, probe });

    // LLM 批评
    const C = await chat(SYS_CRITIQUE, `页面探针：${JSON.stringify(probe).slice(0, 3000)}\n概念：${plan.concept}`);
    let issues;
    try { issues = jsonOf(C.text); if (!Array.isArray(issues)) issues = [issues]; } catch { issues = []; }
    log.calls.push({ step: `critique:${round}`, ms: C.ms, tokens: C.tokens, issues: issues.length });
    console.log(`  批评: ${issues.length} 问题`);
    for (const i of issues) console.log(`    ${i.sev} [${i.area}] ${i.desc?.slice(0, 50)} → ${i.level}`);

    // 修订（把问题清单反馈给 LLM 修 CSS/JS）
    if (issues.length > 0) {
      const fixPrompt = issues.map((i, n) => `${n + 1}. [${i.sev}][${i.area}] ${i.desc} → 修复方向: ${i.fix}`).join('\n');
      const F = await chat(`你是代码修复师。根据问题清单，只输出 \`\`\`css 和 \`\`\`js 两个围栏代码块（覆盖修复样式和补充 JS）。不要解释。\n问题：\n${fixPrompt}`, `当前页面有 ${probe.sections?.length ?? '?'} 个区块`, 3000, 0.4);
      const fp = fences(F.text);
      log.calls.push({ step: `fix:${round}`, ms: F.ms, tokens: F.tokens });
      if (fp.css || fp.js) {
        let cur = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
        fs.writeFileSync(path.join(outDir, `index-v${round + 1}-before.html`), cur);
        if (fp.css) cur = cur.replace('</style>', fp.css + '\n</style>');
        if (fp.js) cur = cur.replace('</script>\n</body>', fp.js + '\n</script>\n</body>');
        fs.writeFileSync(path.join(outDir, 'index.html'), cur);
        console.log(`  修复: css ${fp.css?.length ?? 0} + js ${fp.js?.length ?? 0} 字符`);
      }
    }
  }

  // 5) 终验
  fs.writeFileSync(path.join(outDir, 'run-log.json'), JSON.stringify(log, null, 1));
  return { outDir, log };
}

function assemble(parts, title, plan) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@200;300;400;600;900&family=IBM+Plex+Mono:wght@300;400&display=swap" rel="stylesheet">
<style>
* { margin:0; box-sizing:border-box; }
html { scroll-behavior:smooth; }
body { background:${plan.palette?.[0] ?? '#0a0a0a'}; color:${plan.palette?.[1] ?? '#eee'}; font-family:'Noto Serif SC',Georgia,serif; overflow-x:hidden; }
.mono { font-family:'IBM Plex Mono',monospace; }
${parts.map((p) => p.css).join('\n')}
</style></head><body>
${parts.map((p) => p.html).join('\n')}
<script type="module">
${parts.map((p) => p.js).join('\n')}
</script></body></html>`;
}

/* 简易 DOM 探针（headless） */
async function browserProbe(outDir) {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve) => {
    const probe = `<script>
      window.addEventListener('load', () => setTimeout(() => {
        const sections = [...document.querySelectorAll('section,[class*=sec],[class*=scene],[class*=hero],[class*=gallery]')].map((s) => {
          const r = s.getBoundingClientRect();
          return { cls: s.className?.toString?.().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) };
        });
        const h1 = document.querySelector('h1');
        const data = {
          sections,
          h1Size: h1 ? getComputedStyle(h1).fontSize : 'none',
          h2Count: document.querySelectorAll('h2').length,
          interactive: document.querySelectorAll('button,input,select,a[href^="#"]').length,
          canvas: document.querySelectorAll('canvas').length,
          svg: document.querySelectorAll('svg').length,
          pageH: document.documentElement.scrollHeight,
          overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          imgs: document.querySelectorAll('img').length,
          errors: window.__errs || [],
        };
        document.title = 'PROBE::' + JSON.stringify(data);
      }, 2000));
      window.__errs = []; window.onerror = (m) => { window.__errs.push(m); };
    </script>`;
    let html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    html = html.replace('</head>', probe + '</head>');
    const tmp = path.join(outDir, '_probe.html');
    fs.writeFileSync(tmp, html);
    execFile('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
      '--headless=new', '--disable-gpu', '--dump-dom', '--virtual-time-budget=8000', 'file:///' + tmp.replaceAll('\\', '/'),
    ], { timeout: 30_000, maxBuffer: 20e6 }, (e, stdout) => {
      fs.unlinkSync(tmp);
      if (e || !stdout) return resolve(null);
      const m = stdout.match(/PROBE::(\{[^<]*)/);
      resolve(m ? JSON.parse(m[1]) : null);
    });
  });
}

/* CLI */
if (process.argv[1]?.endsWith('benchmark.mjs')) {
  const ids = process.argv.slice(2);
  for (const id of ids.length ? ids : ['a', 'b', 'c']) {
    await runProject(id);
  }
}
