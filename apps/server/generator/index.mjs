/**
 * 一句话 → 应用规格：意图识别（规则版）。
 * P4 接入 Model Gateway 后，这里可替换为 LLM 解析（接口不变：sentence → spec）。
 */
import * as todo from './templates/todo.mjs';
import * as pomodoro from './templates/pomodoro.mjs';
import * as counter from './templates/counter.mjs';
import * as notes from './templates/notes.mjs';
import * as gallery from './templates/gallery.mjs';
import * as countdown from './templates/countdown.mjs';
import * as landing from './templates/landing.mjs';
import * as atlas from './templates/atlas.mjs';
import { pwaAssets, pwaHead } from './pwa.mjs';
import { detectStyle, findStyle, styleWordsRegex, styleAccentOf } from './styles.mjs';
import { detectFx, fxLevelOf, fxBoot, fxSource } from './fx.mjs';

export const TEMPLATES = { todo, pomodoro, counter, notes, gallery, countdown, landing, atlas };

/** 展馆主题词提取：「做法拉利展馆」→「法拉利」（先剥动词与风格词，避免"做法拉利"被拆成"做法"） */
export function extractSubject(sentence) {
  let s = String(sentence ?? '')
    .replace(/帮我|请|我要|想要|来个?|做一个|做一款|做|写一个|写|开发一个|开发|创建|生成|制作|设计|弄|搞|一个|一款|展示|关于|主题是?|的/g, ' ')
    .replace(styleWordsRegex(), ' ')
    .replace(/展馆|画廊|图库|相册|收藏夹|展览|网站|应用|App|web|Web|gallery|showroom/gi, ' ')
    .replace(/[\s,，、。！!]+/g, ' ')
    .trim();
  if (!s) s = String(sentence ?? '').trim() || '精选';
  return s.slice(0, 24);
}

/** 标题提取：引号 > 命名句 > 展馆主题词+类别词 > 「一个XX」模式 > 兜底模板名 */
function extractTitle(sentence, tpl) {
  const s = String(sentence ?? '').trim();
  const quoted = s.match(/[「『"“]([^」』"”]{1,20})[」』"”]/);
  if (quoted) return quoted[1].trim();
  const named = s.match(/(?:叫|名称是?|叫做)\s*(.{2,16})/);
  if (named) return named[1].trim();
  const subject = extractSubject(s);
  if (tpl.meta.type === 'gallery') {
    const kw = tpl.meta.keywords.find((k) => k.length <= 3 && s.toLowerCase().includes(k.toLowerCase()));
    return `${subject}${kw ?? '展馆'}`;
  }
  const m = s.match(/一个(.{1,12}?)(?:App|应用|网站|web|Web|工具|页面|$)/);
  if (m && m[1].trim()) return m[1].trim();
  return subject.length >= 2 ? subject : tpl.meta.name;
}

export function parseSentence(sentence, opts = {}) {
  void 0;
  const s = String(sentence ?? '').trim();
  const hits = [];
  for (const tpl of Object.values(TEMPLATES)) {
    const score = tpl.meta.keywords.reduce((acc, k) => acc + (s.toLowerCase().includes(k.toLowerCase()) ? k.length : 0), 0);
    if (score > 0) hits.push({ tpl, score });
  }
  hits.sort((a, b) => b.score - a.score);
  const tpl = hits[0]?.tpl ?? TEMPLATES.todo;
  const title = extractTitle(s, tpl);
  return {
    type: tpl.meta.type,
    template: tpl,
    title,
    subtitle: `OrchestrAI 生成`,
    features: tpl.meta.features,
    plantDefect: /预设缺陷|故意|植入/.test(s),
    styleId: (opts.styleId && findStyle(opts.styleId) ? opts.styleId : null) ?? detectStyle(s),
    fxLevel: (opts.fxLevel && ['off', 'subtle', 'full'].includes(opts.fxLevel) ? opts.fxLevel : null) ?? detectFx(s),
    styleDescription: (opts.styleDescription ?? '').trim().slice(0, 120) || null,
    matchedBy: hits.length > 0 ? `命中关键词 → ${tpl.meta.name}` : '未命中关键词，使用兜底模板「任务清单」',
  };
}

export function buildFiles(spec, { defect = false } = {}) {
  const base = defect ? spec.template.defectVariant(spec.template.files(spec)) : spec.template.files(spec);
  // 动效级别先定（extraAssets 需在 SW 生成前就位）
  const level = fxLevelOf(spec);
  spec.resolvedFx = level;
  if (level !== 'off') {
    spec.extraAssets = [...new Set([...(spec.extraAssets ?? []), './fx.js'])];
  }
  // PWA 化在生成器入口统一完成（横切关注点，模板不感知）：
  // 1) 注入 manifest / 图标 / 主题色 / SW 注册头；2) 合并 PWA 资产文件
  const html = base['index.html'] ?? '';
  const head = pwaHead(spec);
  const withPwa = html.includes('</head>')
    ? html.replace('</head>', `${head}\n</head>`)
    : `${head}\n${html}`;
  const files = { ...base, 'index.html': withPwa, ...pwaAssets(spec) };
  if (level !== 'off') {
    files['index.html'] = files['index.html'].replace('</body>', `${fxBoot(spec, level, styleAccentOf(spec))}\n</body>`);
    files['fx.js'] = fxSource();
  }
  return files;
}
