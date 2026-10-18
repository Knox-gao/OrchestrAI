/**
 * 反馈闭环验证：执行器检测到"五幕零 JS"后，把缺陷反馈给模型补齐每幕交互 JS，注入页面。
 * 验证目标：开放式路径 + 最小护栏（完整性校验→定向反馈重试）能否达到交付完整性。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const { getKeys } = await import(pathToFileURL(path.join(ROOT, 'apps/server/keys.mjs')).href);
const REQ = '为独立黑胶唱片店「拾音角」做官网：本周上新唱片墙（专辑/厂牌/价位）、店内试听位预约（两台唱机三个时段）、店主每周选歌故事';

async function chat(system, user, maxTokens = 3000) {
  const key = getKeys().zhipu;
  const t0 = performance.now();
  const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'glm-5.3-flash', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.5, max_tokens: maxTokens, thinking: { type: 'disabled' } }),
    signal: AbortSignal.timeout(180_000),
  });
  const j = await res.json();
  return { text: j.choices?.[0]?.message?.content ?? '', ms: Math.round(performance.now() - t0), tokens: j.usage?.total_tokens ?? null };
}
const fences = (t) => { const out = []; for (const m of t.matchAll(/```js\n([\s\S]*?)```/g)) out.push(m[1].trim()); return out.join('\n'); };

let html = fs.readFileSync(path.join(HERE, 'out', 'index.html'), 'utf8');
fs.writeFileSync(path.join(HERE, 'out', 'index-v1-nojs.html'), html); // 缺陷版存证

const sections = [...html.matchAll(/<section[^>]*class="([^"]*)"[^>]*>/g)].map((m) => m[1]);
console.log('检测到的幕 class:', sections.join(', '));
const tasks = [
  { name: '唱片墙筛选', need: 'wall/upd 类幕：本周上新墙——实现按厂牌或价位筛选唱片条目的真实交互（点击过滤，无结果提示）' },
  { name: '试听位预约', need: 'listen 类幕：试听位预约——两台唱机（A/B）×三个时段，点击选择后弹出/内联确认（姓名输入+登记成功提示），本地状态即可' },
  { name: '门面动效', need: 'hero 类幕：门面——一个克制的进场编排（标题渐显+一个可指认的主视觉动效，尊重 prefers-reduced-motion）' },
];
const jsParts = [];
const calls = [];
for (const t of tasks) {
  const r = await chat(
    `你在为已完成的单页网站补齐缺失的交互 JS。网站需求：${REQ}\n页面已有幕 class：${sections.join(', ')}。\n本次任务：${t.need}\n只输出一个 \`\`\`js 围栏代码块：立即执行函数包裹，querySelector 挂到对应幕 class 上，不依赖外部库，可直接运行。`,
    '任务：' + t.need,
  );
  const code = fences(r.text);
  calls.push({ task: t.name, ms: r.ms, tokens: r.tokens, codeLen: code.length });
  if (code) jsParts.push(`/* ${t.name} */\n${code}`);
  console.log(t.name, code ? '✓ ' + r.ms + 'ms ' + code.length + '字符' : '✗ 空');
}
if (jsParts.length) {
  html = html.replace('</body>', `<script type="module">\n${jsParts.join('\n\n')}\n</script>\n</body>`);
  fs.writeFileSync(path.join(HERE, 'out', 'index.html'), html);
  fs.writeFileSync(path.join(HERE, 'fix-meta.json'), JSON.stringify({ calls }, null, 1));
  console.log('已注入', jsParts.length, '段交互 JS → out/index.html（v1 缺陷版另存）');
}
