/**
 * 开放式按需实现路径（实验 B）：LLM 自主产代码，执行器只做保存/拼接/记录。
 * 与 Scene Composer 的区别：无能力白名单、无枚举、无固定骨架——模型自己决定
 * 架构、组件、布局、交互与图形技术；唯一约束=单文件可运行 + 基线可访问性。
 * 链路：规划（1 调用）→ 分幕实现（N 调用，每幕产 section HTML + CSS + JS 文本块）→ 字符串拼接 → 落盘。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const { getKeys } = await import(pathToFileURL(path.join(ROOT, 'apps/server/keys.mjs')).href);

const REQ = '为独立黑胶唱片店「拾音角」做官网：本周上新唱片墙（专辑/厂牌/价位）、店内试听位预约（两台唱机三个时段）、店主每周选歌故事，让访客想来看店';

async function chat(system, user, maxTokens = 3800, temperature = 0.6) {
  const key = getKeys().zhipu;
  const t0 = performance.now();
  const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'glm-5.3-flash', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature, max_tokens: maxTokens, thinking: { type: 'disabled' } }),
    signal: AbortSignal.timeout(180_000),
  });
  const j = await res.json();
  return { text: j.choices?.[0]?.message?.content ?? '', tokens: j.usage?.total_tokens ?? null, ms: Math.round(performance.now() - t0) };
}
const jsonOf = (t) => { const s = t.indexOf('{'); return JSON.parse(t.slice(s, t.lastIndexOf('}') + 1)); };
/** 从模型回复中提取围栏代码块：```html / ```css / ```js */
function fencesOf(text) {
  const out = { html: '', css: '', js: '' };
  const re = /```(html|css|js)\n([\s\S]*?)```/g;
  for (const m of text.matchAll(re)) out[m[1]] = m[2].trim();
  return out;
}

const calls = [];
/* 1) 自主规划：模型决定幕数/结构/技术/交互（不受任何枚举约束） */
const P1 = await chat(
  `你是自主产品设计师兼架构师。为需求规划一个单页网站的实现方案（只输出 JSON）。
你完全自主决定：信息架构、幕次数量与顺序、每幕的组件与布局、交互机制、图形技术（Canvas/SVG/CSS 皆可，按需选择）、配色与排印。没有模板，没有能力清单，没有枚举。
约束仅有：单文件 HTML 可直接运行；中文文案具体可信（示例数据标注口径）；必须有至少两个真实可操作的交互；移动端可用。
输出：{"concept":"一句主张","structure":[{"id":"","name":"","what":"","tech":"","interaction":""}],"palette":["#hex"],"notes":""}`,
  REQ,
);
const plan = jsonOf(P1.text);
calls.push({ step: 'plan', ms: P1.ms, tokens: P1.tokens });
console.log('规划 ✓', P1.ms + 'ms', '|', plan.structure.map((s) => s.id + ':' + s.name).join(' → '));
console.log('概念:', plan.concept);

/* 2) 分幕实现：每幕一次调用，产 HTML 片段 + CSS + JS 三段文本（模型自主设计，执行器不加工） */
const parts = [];
for (const s of plan.structure) {
  const others = plan.structure.filter((x) => x.id !== s.id).map((x) => x.id + '=' + x.name).join('；');
  const SYSTEM_SCENE = `你正在实现单页网站的一幕。全站结构：${others}。配色族：${JSON.stringify(plan.palette)}。
本幕：${JSON.stringify(s)}。
只输出三个围栏代码块（html/css/js，不要 JSON 不要解释）。代码完整可直接运行；样式挂本幕 section 专属 class；JS 用 (()=>{ … })(); 包裹；交互真实生效；质量对标作品级网页；中文为主；输出完整收尾。`;
  const r = await chat(SYSTEM_SCENE, '需求：' + REQ + '\n本幕规格：' + JSON.stringify(s));
  let part = fencesOf(r.text);
  if (!part.html || !part.css) {
    console.log('幕', s.id, '围栏不完整，重试一次');
    const r2 = await chat(SYSTEM_SCENE, '需求：' + REQ + '\n本幕规格：' + JSON.stringify(s));
    part = fencesOf(r2.text);
    calls.push({ step: 'scene:' + s.id + ':retry', ms: r2.ms, tokens: r2.tokens });
  }
  calls.push({ step: 'scene:' + s.id, ms: r.ms, tokens: r.tokens });
  parts.push(part);
  console.log('幕', s.id, '✓', r.ms + 'ms', '| html', part.html.length, 'css', part.css.length, 'js', part.js.length);
}

/* 3) 执行器拼接（纯字符串级，零结构约束） */
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>拾音角 — 开放式路径（实验 B）</title>
<style>
* { margin:0; box-sizing:border-box; }
html { scroll-behavior:smooth; }
body { background:#0d0b09; color:#efe6d8; font-family:Georgia,'Songti SC',serif; }
${parts.map((p) => p.css).join('\n')}
</style></head><body>
${parts.map((p) => p.html).join('\n')}
<script type="module">
${parts.map((p) => p.js).join('\n')}
</script></body></html>`;
fs.mkdirSync(path.join(HERE, 'out'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'out', 'index.html'), html);
fs.writeFileSync(path.join(HERE, 'run-meta.json'), JSON.stringify({ plan, calls, req: REQ, parts: parts.map((p, i) => ({ i, htmlLen: p.html.length, cssLen: p.css.length, jsLen: p.js.length })) }, null, 1));
const totalMs = calls.reduce((a, c) => a + c.ms, 0), totalTk = calls.reduce((a, c) => a + (c.tokens ?? 0), 0);
console.log('完成 → out/index.html |', calls.length, '次调用 |', totalMs, 'ms |', totalTk, 'tokens');
