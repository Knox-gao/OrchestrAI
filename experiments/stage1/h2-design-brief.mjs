/**
 * H2 实验：LLM 能否稳定输出结构化 Design Brief（含两个实质差异的设计方向）
 * 实测指标：JSON 解析成功率 / 必填字段完整率 / 无效字段比例 / 重试次数 / 延迟 / tokens
 * 两个真实需求 × 各 3 轮：①高端建筑设计事务所官网 ②漫威超级英雄图鉴
 * 产出：h2-result.json
 * 注意：直接调用 GLM 原始 API 以捕获 usage（项目内 chat() 不回传 usage）；Key 仅从本机 keys.mjs 读取。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const { getKeys } = await import(pathToFileURL(path.join(ROOT, 'apps', 'server', 'keys.mjs')).href);

const SYSTEM = `你是 OrchestrAI 的首席产品设计师。为以下网站需求输出结构化 Design Brief（只输出 JSON）。
要求：
1. directions 必须包含 2 个**实质差异**的设计方向——在布局策略、首屏构图、内容密度、图片使用、页面节奏、交互方式上至少 4 项不同；只换颜色/圆角不算差异。
2. layoutStrategy 从这些中选：editorial(编辑式宽幅叙事) / workbench(数据密集工作台) / stage(沉浸舞台) / minimal(极简品牌) / magazine(杂志编排) / showcase(作品集展示) / catalog(内容发现流)。
3. 所有文字具体、可执行，禁止空话（如"现代简洁"）。

JSON 结构：
{"positioning":{"audience":"目标用户","mission":"网站任务","conversion":"转化目标"},
 "brandKeywords":["3-5个关键词"],
 "references":[{"site":"参考站点","takeaway":"借鉴的具体设计特征"}],
 "directions":[{"name":"方向名","layoutStrategy":"上述枚举","heroComposition":"首屏构图描述","density":"内容密度(高/中/低+说明)","typography":{"display":"标题字体气质与字阶","body":"正文字体"},"imageUse":"图片使用方式","color":{"bg":"背景基调","accent":"#hex主色","mood":"色彩情绪"},"motion":"动效原则","rhythm":"页面节奏"} , { 第二个方向 }],
 "tokens":{"maxWidth":"内容最大宽度px","grid":"栅格描述","spacingScale":"间距尺度","radius":"圆角规则","breakpoints":"断点"},
 "imageDirection":{"style":"整站图片风格(摄影/插画/3D等)","mood":"光线与情绪","composition":"构图语言","palette":"色彩倾向","avoid":"禁止出现的内容"},
 "a11y":{"contrast":"对比度要求","minBodyPx":"正文字号下限"}}

重要：输出精简且完整收尾，总输出必须以最后一个 } 完整结束。`;

const REQ = {
  arch: '项目名：境屿建筑\n需求：为一家高端建筑设计事务所做官网，作品以美术馆和文化建筑为主，客户是私人藏家与地产基金，需要体现专业、克制、材料质感，联系我们表单要突出',
  marvel: '项目名：漫威超级英雄图鉴\n需求：生成漫威的所有超级英雄的介绍网页，要求带照片和介绍，必须包含银河护卫队全部成员',
};

const REQUIRED_PATHS = [
  'positioning.audience', 'positioning.mission', 'positioning.conversion',
  'brandKeywords', 'references[0].site', 'references[0].takeaway',
  'directions[0].name', 'directions[0].layoutStrategy', 'directions[0].heroComposition', 'directions[0].density', 'directions[0].typography.display', 'directions[0].imageUse', 'directions[0].color.accent', 'directions[0].motion', 'directions[0].rhythm',
  'directions[1].name', 'directions[1].layoutStrategy', 'directions[1].heroComposition', 'directions[1].density', 'directions[1].imageUse', 'directions[1].color.accent',
  'tokens.maxWidth', 'tokens.grid', 'tokens.spacingScale', 'tokens.radius', 'tokens.breakpoints',
  'imageDirection.style', 'imageDirection.mood', 'imageDirection.composition', 'imageDirection.palette', 'imageDirection.avoid',
  'a11y.contrast', 'a11y.minBodyPx',
];
const LAYOUT_ENUM = ['editorial', 'workbench', 'stage', 'minimal', 'magazine', 'showcase', 'catalog'];

const get = (o, p) => p.replace(/\[(\d)\]/g, '.$1').split('.').reduce((a, k) => (a == null ? a : a[k]), o);

async function callGlm(requirement) {
  const keys = getKeys();
  const key = keys.zhipu;
  const t0 = performance.now();
  const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'glm-5.3-flash',
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `项目需求：\n${requirement}` },
      ],
      temperature: 0.4,
      max_tokens: 4000,
      thinking: { type: 'disabled' },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await res.json();
  const ms = Math.round(performance.now() - t0);
  return { text: data?.choices?.[0]?.message?.content ?? '', usage: data?.usage, ms };
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return JSON.parse(text.slice(start, end + 1));
}

const out = { runs: [], summary: {} };
for (const [label, req] of Object.entries(REQ)) {
  for (let i = 1; i <= 3; i++) {
    const rec = { label, run: i, retries: 0 };
    let parsed = null;
    for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
      try {
        const r = await callGlm(req);
        rec.ms = r.ms;
        rec.tokens = r.usage ? { in: r.usage.prompt_tokens, out: r.usage.completion_tokens, total: r.usage.total_tokens } : null;
        parsed = extractJson(r.text);
      } catch (e) {
        rec.retries++;
        rec.lastErr = String(e.message).slice(0, 60);
      }
    }
    if (!parsed) { rec.parseOk = false; out.runs.push(rec); continue; }
    rec.parseOk = true;
    rec.missing = REQUIRED_PATHS.filter((p) => {
      const v = get(parsed, p);
      return v === undefined || v === null || String(v).trim() === '';
    });
    rec.fieldRate = +((REQUIRED_PATHS.length - rec.missing.length) / REQUIRED_PATHS.length).toFixed(3);
    // 无效字段：layoutStrategy 不在枚举 / accent 非 hex / directions 少于 2
    rec.invalid = [];
    for (const d of parsed.directions ?? []) {
      if (!LAYOUT_ENUM.includes(d?.layoutStrategy)) rec.invalid.push('layoutStrategy:' + d?.layoutStrategy);
      if (!/^#[0-9a-fA-F]{6}$/.test(String(d?.color?.accent ?? ''))) rec.invalid.push('accent:' + d?.color?.accent);
    }
    if ((parsed.directions ?? []).length < 2) rec.invalid.push('directions<2');
    // 双方向实质差异：比较 6 个维度
    const [a, b] = parsed.directions ?? [{}, {}];
    const dims = {
      layoutStrategy: a.layoutStrategy !== b.layoutStrategy,
      hero: String(a.heroComposition ?? '') !== String(b.heroComposition ?? ''),
      density: String(a.density ?? '') !== String(b.density ?? ''),
      imageUse: String(a.imageUse ?? '') !== String(b.imageUse ?? ''),
      rhythm: String(a.rhythm ?? '') !== String(b.rhythm ?? ''),
      motion: String(a.motion ?? '') !== String(b.motion ?? ''),
    };
    rec.diffDims = Object.values(dims).filter(Boolean).length;
    rec.diffDetail = dims;
    rec.strategies = [a.layoutStrategy, b.layoutStrategy];
    rec.names = [a.name, b.name];
    out.runs.push(rec);
  }
}

const okRuns = out.runs.filter((r) => r.parseOk);
out.summary = {
  runs: out.runs.length, parseOk: okRuns.length,
  fieldCompleteRuns: okRuns.filter((r) => r.missing.length === 0).length,
  avgFieldRate: +(okRuns.reduce((a, r) => a + r.fieldRate, 0) / Math.max(1, okRuns.length)).toFixed(3),
  invalidFieldRuns: okRuns.filter((r) => r.invalid.length > 0).length,
  retryTotal: out.runs.reduce((a, r) => a + (r.retries || 0), 0),
  avgMs: Math.round(okRuns.reduce((a, r) => a + r.ms, 0) / Math.max(1, okRuns.length)),
  avgTokens: okRuns.reduce((a, r) => a + (r.tokens?.total ?? 0), 0) / Math.max(1, okRuns.length),
  runsDiffGte4: okRuns.filter((r) => r.diffDims >= 4).length,
};
fs.writeFileSync(path.join(HERE, 'h2-result.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.summary, null, 1));
for (const r of out.runs) console.log(r.label, 'run' + r.run, '| parse', r.parseOk, '| 字段率', r.fieldRate, '| 差异维度', r.diffDims, '| 策略', (r.strategies || []).join('/'), r.invalid.length ? '| 无效:' + r.invalid.join(',') : '');
