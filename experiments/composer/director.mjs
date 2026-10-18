/**
 * Creative Director + Scene/Transition Composer（LLM 生成创意方案 → 可编译 JSON）
 * 能力与转场机制必须来自白名单；幕次须有起伏（开场/发展/高潮/收束）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const { getKeys } = await import(pathToFileURL(path.join(ROOT, 'apps/server/keys.mjs')).href);

const CAPS = {
  cinematicStage: '电影级舞台（体积光束/尘粒/定场字幕）params:{kick,title,sub,accent,ink,beamColor,dustColor,bgTop,bgBottom}',
  pressureType: '动态排印压缩 params:{kicker,stages:[三短语],note,meta,accent,from:{spacing,weight},to:{spacing,weight}}',
  flowField: 'GPU荧光粒子流场（可搅动）params:{label,stirLabel,side,count,bg,dim:"r,g,b",lit:"r,g,b"}',
  productStage: '产品舞台（拖转六面体+规格）params:{kicker,name,tagline,accent,bg,ink,specs:[["k","v"]],cta,ctaTarget}',
  galleryWall: '非对称作品墙 params:{kicker,heading,accent,ink,works:[{t,y,d,hue}]}',
  dataLedger: '数据带档案 params:{kicker,heading,accent,ink,records:[{no,name,en,note,stats:[["k","v"]]}]}',
  ledgerClose: '结束幕（CTA）params:{heading,note,cta,accent,ink,foot}',
};
const TRAN = {
  decomposeGrid: '字符散解重组为色谱网格 params:{fromPhrase,color}',
  inkExpand: '主色圆形吞没 params:{color,word}',
  depthPush: '景深推近 params:{word,bg}',
  letterformHandoff: '巨字交接 params:{glyph,color}',
};

const SYSTEM = `你是 OrchestrAI 的创意总监与场景作曲家。为网站需求产出"可执行创意方案"（只输出 JSON）。
铁律：
1. 概念必须具体可指认（一个隐喻/主张/世界观），禁"高级/现代/沉浸/未来感"空话；视觉辨识度来源必须写明。
2. scenes 用白名单能力编排，3-5 幕，必须起伏：开场(定场/气氛)→发展(信息/展示)→视觉高潮(核心交互/最大体量)→收束(转化/回响)；不同幕用不同能力；相邻幕风格参数（配色族/明暗）保持同族。
3. 每对相邻场景给 transitions（机制白名单），转场要有语义理由（why），不要全是同一种。
4. 每幕 params 必须按能力的参数表填写真实文案/数据/色值（色值 #RRGGBB），文案要具体、贴合需求、可直接上屏（中文为主，配英文小字）。
5. acceptance 可检验（"首屏能指认X""点击Y在Z内反馈"）。
能力白名单：
${Object.entries(CAPS).map(([k, v]) => `- ${k}: ${v}`).join('\n')}
转场白名单：
${Object.entries(TRAN).map(([k, v]) => `- ${k}: ${v}`).join('\n')}
JSON：
{"concept":{"claim":"一句创意主张","identity":"辨识度来源","audience":"","task":""},
 "artDirection":{"palette":["#hex×3-5"],"ink":"","typography":"","material":"","graphics":""},
 "narrative":"幕次弧线一句话",
 "scenes":[{"id":"s1","name":"","purpose":"","capability":"","params":{},"enter":"","exit":"","mobile":"","accept":[""]}],
 "transitions":[{"after":"s1","mechanism":"","params":{},"why":""}],
 "acceptance":["×2"]}
输出精简完整收尾，必须以最后一个 } 结束。`;

export async function runDirector(requirement, projectName) {
  const key = getKeys().zhipu;
  const t0 = performance.now();
  let tries = 0, data = null, tokens = null, lastErr = null;
  for (let a = 1; a <= 2 && !data; a++) {
    tries++;
    try {
      const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: 'glm-5.3-flash', messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: `项目：${projectName}\n需求：${requirement}` }], temperature: 0.55, max_tokens: 4500, thinking: { type: 'disabled' } }),
        signal: AbortSignal.timeout(150_000),
      });
      const j = await res.json();
      tokens = j.usage?.total_tokens ?? null;
      const text = j.choices?.[0]?.message?.content ?? '';
      data = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    } catch (e) { lastErr = e; }
  }
  const callMeta = { ms: Math.round(performance.now() - t0), tries, tokens };
  if (!data) throw Object.assign(new Error('Director 解析失败：' + String(lastErr?.message ?? lastErr).slice(0, 90)), { callMeta });
  return { plan: data, callMeta };
}

/** 方案校验（编译前）：能力/机制白名单、幕次结构、转场衔接 */
export function validatePlan(p) {
  const errs = [];
  const capIds = Object.keys(CAPS);
  const tranIds = Object.keys(TRAN);
  if (!Array.isArray(p.scenes) || p.scenes.length < 3) errs.push('至少 3 幕');
  const ids = [];
  for (const s of p.scenes ?? []) {
    ids.push(s.id);
    if (!capIds.includes(s.capability)) errs.push(`场景 ${s.id} 能力非法：${s.capability}`);
    if (!s.params || typeof s.params !== 'object') errs.push(`场景 ${s.id} 缺 params`);
  }
  if (new Set(ids).size !== ids.length) errs.push('场景 id 重复');
  for (const t of p.transitions ?? []) {
    if (!tranIds.includes(t.mechanism)) errs.push(`转场机制非法：${t.mechanism}`);
    if (!ids.includes(t.after)) errs.push(`转场 after 指向不存在的场景：${t.after}`);
  }
  // 相邻幕缺转场 → 编译器自动补 depthPush（不算错误，记录提示）
  return { ok: errs.length === 0, errors: errs, scenes: ids };
}
