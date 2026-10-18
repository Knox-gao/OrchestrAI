/**
 * 跨主题隐喻驱动实验：LLM 推导视觉隐喻中间产物（8 项结构化产物）
 * 诚实记录：每次调用的耗时/重试；产物是"前端实现的输入"，非最终页面。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const { getKeys } = await import(pathToFileURL(path.join(ROOT, 'apps/server/keys.mjs')).href);

const SYSTEM = `你是 OrchestrAI 的首席视觉设计师。为网页需求推导「视觉隐喻驱动」的设计中间产物（只输出 JSON）。
铁律：
1. 隐喻物必须是具体名词（如"地层剖面""茶筅击拂的汤面""烘焙度色卡"），禁止"未来感/高级感/极简风"等风格形容词。
2. 隐喻与内容要有语义对应：每个内容块映射到隐喻的一个部位。
3. 不强制构图：只有隐喻本身适合时才用中心装置/满幅节奏/纸面批注等策略；明暗由主题语义决定（文化纸本可浅色、夜间科学可深色）。
4. 交互必须服务叙事（为什么这个操作在这个隐喻里成立）。
JSON：
{"taskHierarchy":{"userTask":"","primaryInfo":"","secondaryInfo":""},
 "candidateMetaphors":[{"object":"","rationale":"","fit":"高|中"},{"×3"]}],
 "selected":{"object":"","why":"","semanticMapping":[{"content":"","mapsTo":""}]},
 "focalObject":{"what":"","compositionRole":"","screenShare":"如 55%","position":""},
 "composition":{"readingPath":"","density":"","negativeSpace":""},
 "interaction":[{"action":"","narrativePurpose":""}],
 "mobileStrategy":"",
 "acceptance":["可检验条件×2"]}
输出精简完整收尾。`;

const THEMES = {
  volcano: '全球火山活动档案图鉴：维苏威、富士山、乞力马扎罗等著名火山，每座含喷发年代/类型/高度数据与介绍，科学信息展示',
  tea: '宋代点茶文化专题页：点茶七汤法步骤、建盏与茶器、斗茶历史，文化专题气质，克制优雅',
  coffee: '独立咖啡烘焙工作室「拾光」官网：当季豆单（产地/烘焙度/风味）、周末手冲课程报名、工作室介绍，目标是让访客预约课程',
};

const key = getKeys().zhipu;
const out = {};
for (const [id, req] of Object.entries(THEMES)) {
  const t0 = performance.now();
  let tries = 0, data = null;
  for (let a = 1; a <= 2 && !data; a++) {
    tries++;
    try {
      const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: 'glm-5.3-flash', messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: '需求：' + req }], temperature: 0.5, max_tokens: 2500, thinking: { type: 'disabled' } }),
        signal: AbortSignal.timeout(120_000),
      });
      const j = await res.json();
      const text = j.choices?.[0]?.message?.content ?? '';
      data = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      out[id] = { brief: data, callMeta: { ms: Math.round(performance.now() - t0), tries, tokens: j.usage?.total_tokens ?? null } };
    } catch (e) { if (a === 2) out[id] = { error: String(e.message).slice(0, 100), callMeta: { ms: Math.round(performance.now() - t0), tries } }; }
  }
  console.log(id, '→', out[id].brief ? `✓ ${out[id].callMeta.ms}ms 重试${out[id].callMeta.tries - 1} | 隐喻: ${out[id].brief.selected.object}` : '✗ ' + out[id].error);
}
fs.writeFileSync(path.join(HERE, 'metaphor-briefs.json'), JSON.stringify(out, null, 1));
console.log('已存 metaphor-briefs.json');
