/**
 * Recovery 2：多页面产品体验重建
 * Bug 清单确证 → 全新信息架构（4 页面 SPA）→ 完整预订流程 → 浏览器验收
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
function extractBlocks(text) {
  const out = { html: '', css: '', js: '' };
  for (const m of text.matchAll(/```(\w+)?\s*\n([\s\S]*?)```/g)) {
    const lang = (m[1] || '').toLowerCase(); const code = m[2].trim();
    if (lang === 'html' || (!lang && code.includes('<'))) out.html += (out.html ? '\n' : '') + code;
    else if (lang === 'css') out.css += (out.css ? '\n' : '') + code;
    else if (lang === 'js' || lang === 'javascript' || lang === 'mjs') out.js += (out.js ? '\n' : '') + code;
  }
  return out;
}

const SYS = `你是资深创意技术总监。为露营地品牌构建完整的多页面预订网站。

BUG 复现报告（必须全部修复）：
1. 旧版表单无 JS 处理（提交=刷新页面）→ 必须实现完整的表单状态机
2. 无导航 → 必须有固定导航栏（品牌+4 页链接+CTA）
3. 内容极薄（3 幕 2 个 h2）→ 必须有真实内容深度
4. 4 个裸 checkbox → 所有 input 必须有 class 和 label

产品需求：
品牌「潮汐露营」——小众精品露营地，3 个营地（海边礁石/森林溪谷/山谷草原），周末运营，城市青年目标客群。

信息架构（SPA hash 路由，4 页面）：
1. #home 品牌首页——潮汐概念视觉（Canvas 潮汐波形可交互）、品牌故事、三营地卡片入口、用户评价
2. #camps 营地探索——3 个营地各有详细展示（设施列表/价格表/特色体验/适合人群），非同构卡片
3. #book 预订流程——三步向导（选营地→选日期人数→确认提交），每步可回退，价格实时计算，提交后显示确认状态
4. #guide 露营指南——潮汐时间表、装备清单（可勾选）、安全须知、FAQ

设计要求：
- 视觉隐喻：潮汐/海岸线（首页用 Canvas 波形，其他页面用色彩与排印呼应，不强制每页都画波浪）
- 品牌色系：深海军蓝 #0a1628 / 潮汐青 #3ec8b8 / 沙滩暖 #e8d5b5 / 泡沫白 #f5f0e8
- 排印：标题 Noto Serif SC 300/600，数据 IBM Plex Mono，正文 14px/2.0
- 交互必须真实：表单验证（必填/格式/边界）、价格实时计算、状态反馈（加载/成功/错误）、日历可选择
- 移动端：导航改汉堡菜单，表单单列
- prefers-reduced-motion 尊重

输出格式：三个围栏代码块（html/css/javascript），html 包含所有 4 个页面的完整结构，css 全站样式，js 路由+交互+表单状态机。

只输出代码，不要解释。输出完整收尾。`;

console.log('=== 多页面重建 ===');
const R = await chat(SYS, '为潮汐露营构建完整多页面预订网站', 4000, 0.7);
const blocks = extractBlocks(R.text);
console.log(`产出: html ${blocks.html.length} css ${blocks.css.length} js ${blocks.js.length}`);

const outDir = path.join(HERE, 'out', 'c');
// 保存当前版为 v2
fs.copyFileSync(path.join(outDir, 'index.html'), path.join(outDir, 'index-v2-recovery.html'));

const full = `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>潮汐露营 — 周末营地预订</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@200;300;400;600;900&family=IBM+Plex+Mono:wght@300;400;500&display=swap" rel="stylesheet">
<style>
* { margin:0; box-sizing:border-box; }
html { scroll-behavior:smooth; }
body { background:#0a1628; color:#f5f0e8; font-family:'Noto Serif SC',Georgia,serif; overflow-x:hidden; }
.mono { font-family:'IBM Plex Mono',monospace; }
a { color:inherit; text-decoration:none; }
${blocks.css}
</style></head><body>
${blocks.html}
<script>
${blocks.js}
</script></body></html>`;
fs.writeFileSync(path.join(outDir, 'index.html'), full);
console.log(`→ ${outDir}/index.html (${full.length} 字符)`);
