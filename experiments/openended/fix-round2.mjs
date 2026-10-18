/** A4 反馈闭环：L1+L2 问题清单 → 定向反馈修复 → 重渲染 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const { getKeys } = await import(pathToFileURL(path.join(ROOT, 'apps/server/keys.mjs')).href);

async function chat(system, user, maxTokens = 3000) {
  const key = getKeys().zhipu;
  const t0 = performance.now();
  const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'glm-5.3-flash', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.45, max_tokens: maxTokens, thinking: { type: 'disabled' } }),
    signal: AbortSignal.timeout(120_000),
  });
  const j = await res.json();
  const text = j.choices?.[0]?.message?.content ?? '';
  const m = text.match(/```css\n([\s\S]*?)```/);
  return { css: m ? m[1].trim() : '', ms: Math.round(performance.now() - t0), tokens: j.usage?.total_tokens ?? null };
}

/* 问题清单（L1 自动化 2 + L2 模型评审 2，A3 修改级别决策=局部修复） */
const ISSUES = [
  { area: 'story', test: '空间利用', desc: '内容 700px 仅占区块 49%，右侧大片空白无设计意图', fix: '扩大 story__inner max-width 至 ~1100px，或在右侧加竖排引文/数据侧栏' },
  { area: 'listen', test: '默认样式', desc: '1 个无 class 的 input（浏览器默认样式残留）', fix: '给预约姓名 input 加设计样式（暗底/暖色边框/等宽字体）' },
  { area: 'hero + 全局', test: '排印层级', desc: 'h1 148px vs h2 32px 字阶比过陡，中间层级缺失', fix: 'story/listen/visit 幕的 h2 从 32px 提至 clamp(42px,4vw,56px)，加 h3 或 eyebrow 级' },
  { area: 'story', test: '构图焦点', desc: 'story 幕整体偏窄且居左，无右侧视觉锚点', fix: 'story__side 或引文竖排放右侧做视觉配重' },
];

let html = fs.readFileSync(path.join(HERE, 'out', 'index.html'), 'utf8');
fs.writeFileSync(path.join(HERE, 'out', 'index-v2-before-fix.html'), html);

const r = await chat(
  `你是网页视觉精修师。根据质量门禁问题清单，只输出一个 \`\`\`css 围栏代码块（覆盖修复样式，用更高优先级选择器如 section.story .story__inner { … } ）。\n问题：\n${ISSUES.map((i, n) => `${n + 1}. [${i.area}] ${i.desc} → ${i.fix}`).join('\n')}\n不要解释，只输出 CSS。`,
  '修复以下 4 个视觉质量问题',
);
console.log('修复 CSS:', r.css.length, '字符 |', r.ms + 'ms', r.tokens + ' tokens');

if (r.css) {
  html = html.replace('</style>', r.css + '\n</style>');
  fs.writeFileSync(path.join(HERE, 'out', 'index.html'), html);
  fs.writeFileSync(path.join(HERE, 'fix-round-meta.json'), JSON.stringify({ issues: ISSUES, call: { ms: r.ms, tokens: r.tokens }, cssLen: r.css.length }, null, 1));
  console.log('已注入 → out/index.html');
}
