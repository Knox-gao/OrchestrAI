/**
 * Recovery 2 修正版：分 3 次调用分别生成 HTML/CSS/JS，拼接为完整多页面 SPA
 * 修复：代码提取率（简单 prompt 让 LLM 专注输出代码围栏）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const { getKeys } = await import(pathToFileURL(path.join(ROOT, 'apps/server/keys.mjs')).href);

async function chat(sys, usr, mt = 4000) {
  const key = getKeys().zhipu;
  const t0 = performance.now();
  const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'glm-5.3-flash', messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }], temperature: 0.7, max_tokens: mt, thinking: { type: 'disabled' } }),
    signal: AbortSignal.timeout(180_000),
  });
  const j = await res.json();
  const text = j.choices?.[0]?.message?.content ?? '';
  const m = text.match(new RegExp('```' + arguments[2]?.lang ?? 'html' + '\\n([\\s\\S]*?)```'));
  return { text, ms: Math.round(performance.now() - t0), tokens: j.usage?.total_tokens ?? null };
}
function grab(text, lang) {
  const m = text.match(new RegExp('```' + lang + '\\n([\\s\\S]*?)```'));
  return m ? m[1].trim() : '';
}

const REQ = `品牌「潮汐露营」——小众精品露营地，3 个营地：海边礁石(¥680/晚)、森林溪谷(¥520/晚)、山谷草原(¥460/晚)。周末运营，装备可租（帐篷¥180/睡袋¥120/焚火台¥90/灯串¥40）。城市青年客群。

页面（SPA hash 路由，4 个 section[data-page]）：
#home 品牌首页——大标题"周五出发，周日潮落前回家"+潮汐概念文案+三营地入口卡（各有不同视觉特色描述）+用户评价3条
#camps 营地详情——3 个营地详细展示：设施列表(水电/淋浴/WiFi/停车位/烧烤区/独木舟等)、适合人群、特色体验（非同构：海边用礁石/赶海主题，森林用溪流/萤火虫主题，山谷用星空/骑行主题）
#book 预订三步向导——step1 选营地（3选1卡片）→ step2 选日期(下月周末日历)+人数(1-8)+装备勾选 → step3 确认页（费用明细+提交按钮）
导航固定顶部（logo+4页链接+CTA按钮），页脚（地址/联系/公众号）`;

console.log('=== 分 3 调用构建多页面 ===');
const results = {};

// 调用 1：HTML 结构
const R1 = await chat('你是前端架构师。根据需求生成完整的 HTML 结构（含导航+4个页面区块+页脚）。只输出一个 ```html 围栏代码块，不要解释。所有 input/button/select 必须有 class。中文文案具体可信。', REQ, 4000);
results.html = grab(R1.text, 'html');
console.log(`HTML: ${results.html.length} 字符 ${R1.ms}ms`);

// 调用 2：CSS
const R2 = await chat(`你是视觉设计师。为已生成的 HTML 编写全站 CSS。只输出一个 \`\`\`css 围栏代码块。
品牌色：深海军蓝#0a1628/潮汐青#3ec8b8/沙滩暖#e8d5b5/泡沫白#f5f0e8。
排印：标题 Noto Serif SC 300/600（已引入），数据 IBM Plex Mono，正文 14px/2.0。
导航固定顶部半透明。SPA路由（非active页面 display:none）。表单三步向导。移动端 @media(max-width:768px) 单列。`, 'CSS for tidal camping site', 4000);
results.css = grab(R2.text, 'css');
console.log(`CSS: ${results.css.length} 字符 ${R2.ms}ms`);

// 调用 3：JS
const R3 = await chat(`你是交互工程师。为露营预订网站编写 JavaScript。只输出一个 \`\`\`javascript 围栏代码块。
功能：①hash 路由（#/home #/camps #/book #/guide 切换 section[data-page] 的 display）②预订三步向导状态机（下一步/上一步/表单验证/价格实时计算/提交后显示确认）③导航 active 状态 ④移动端汉堡菜单。
价格：营地 ¥680/¥520/¥460 每晚 × 晚数 + 装备（帐篷¥180/睡袋¥120/焚火台¥90/灯串¥40）。
本地模拟提交（setTimeout 1s 后显示确认面板），标注"本地演示"。
用普通 script（非 module），IIFE 包裹。`, 'JavaScript for tidal camping booking', 4000);
results.js = grab(R3.text, 'javascript') || grab(R3.text, 'js');
console.log(`JS: ${results.js.length} 字符 ${R3.ms}ms`);

// 拼接
const outDir = path.join(HERE, 'out', 'c');
fs.copyFileSync(path.join(outDir, 'index.html'), path.join(outDir, 'index-v2-recovery.html'));
const full = `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>潮汐露营 — 周末营地预订</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@200;300;400;600;900&family=IBM+Plex+Mono:wght@300;400;500&display=swap" rel="stylesheet">
<style>
*{margin:0;box-sizing:border-box}html{scroll-behavior:smooth}
body{background:#0a1628;color:#f5f0e8;font-family:'Noto Serif SC',Georgia,serif;overflow-x:hidden}
a{color:inherit;text-decoration:none}
.mono{font-family:'IBM Plex Mono',monospace}
${results.css}
</style></head><body>
${results.html}
<script>
${results.js}
</script></body></html>`;
fs.writeFileSync(path.join(outDir, 'index.html'), full);
console.log(`\n完整站点 → ${outDir}/index.html (${full.length} 字符)`);
console.log(`HTML ${results.html.length} | CSS ${results.css.length} | JS ${results.js.length}`);
