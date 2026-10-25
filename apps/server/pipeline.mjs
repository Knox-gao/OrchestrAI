/**
 * 真实生成流水线：一句话 → 真实文件 → 真实测试 → 真实交付事件。
 * 产出与演示剧本同构的事件队列（Cue[]），客户端走完全相同的渲染与门禁逻辑。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSentence, buildFiles, extractSubject, TEMPLATES } from './generator/index.mjs';
import { staticCheck } from './generator/quality.mjs';
import { staticCheckPagePlan, buildWorkspaceTest } from './generator/pageplan/pageplan-gate.mjs';
import { runNodeTests } from './runner.mjs';
import { collectImages, queryCascade, bestMatch, extractEnglishTokens, downloadImage } from './scraper.mjs';
import { wikipediaCharacterPortraitCandidates } from './wiki-portrait.mjs';
import { visualAudit } from './visualaudit.mjs';
import { auditRequirementCoverage } from './reqcoverage.mjs';
import { generatePagePlan, PagePlanGenerationError, assessPagePlanVisualComposition } from './generator/pageplan/generate.mjs';
import { renderPagePlan, PagePlanBlockedError } from './generator/pageplan/render.mjs';
import { SCENE3D_RUNTIME } from './generator/pageplan/scene3d.mjs';
import { resolveThemeTokens } from './generator/pageplan/style-resolver.mjs';
import { bundlePagePlanAssets, collectImageNodes } from './generator/pageplan/assets.mjs';
import { createTopicIllustration } from './generator/pageplan/illustration.mjs';
import { evaluateRequirementCoverage } from './generator/pageplan/coverage-status.mjs';
import { crossCheckBriefAgainstScene } from './generator/pageplan/scene-brief.mjs';
import { checkSceneGeometry, summariseSceneReview } from './generator/pageplan/scene-review.mjs';
import { assertAssetsResolved } from './generator/pageplan/asset-resolution-gate.mjs';
import { normalizeProviderUsage } from './generator/pageplan/usage-normalizer.mjs';
import { CATALOG as STYLE_CATALOG } from './generator/styles.mjs';
import { chat as llmChat, chatDetailed } from './llm.mjs';
import { PAGEPLAN_BASE_CAPABILITIES } from './generator/pageplan/generate.mjs';
import { loadAssets, saveAssets, assetEntry, reusableAsset, resolveSlot } from './assets.mjs';
import { generateBrief } from './generator/designbrief.mjs';
import { pickLayout } from './generator/layouts/index.mjs';
import { rankCandidates } from './generator/curator.mjs';
import { renderCheck } from './rendercheck.mjs';
import { getKeys } from './keys.mjs';
import { placeholderCard } from './generator/png.mjs';
import { findStyle, getStyleDef } from './generator/styles.mjs';
import { pickGateway } from './llm.mjs';
import { parseIntentWithLLM } from './intent.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKSPACES = path.join(ROOT, 'workspaces');

const MODEL = { provider: 'local', modelId: 'template-generator-v1' };
const TESTER_MODEL = { provider: 'runtime', modelId: 'node--test-v22' };

function trId(seq) { return `TR-${String(seq).padStart(2, '0')}`; }

/** 有界并发映射（图鉴逐对象采集用） */
async function mapPool(list, limit, fn) {
  const out = new Array(list.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, list.length)) }, async () => {
    while (i < list.length) {
      const idx = i++;
      out[idx] = await fn(list[idx], idx).catch(() => null);
    }
  }));
  return out;
}

function imageSearchTargets(query) {
  const text = String(query ?? '').trim();
  const tokens = text.match(/[\u4e00-\u9fff]{2,}|[A-Za-z0-9][A-Za-z0-9'-]{2,}/g) ?? [];
  const generic = new Set([
    'photo', 'photos', 'photograph', 'photographs', 'photography', 'editorial', 'composition',
    'wide', 'close', 'up', 'scene', 'detail', 'distinct', 'angle', 'view', 'image', 'images',
    'picture', 'pictures', 'real', 'realistic', 'authentic', 'establishing', 'environmental', 'tactile',
    'product', 'products', 'front', 'rear', 'back', 'side', 'view', 'portrait', 'close-up', 'tail', 'lights',
  ]);
  const subjectTokens = tokens.filter((token) => /[\u4e00-\u9fff]/.test(token)
    ? token.length >= 2
    : !generic.has(token.toLowerCase()) && (token.length >= 4 || /^\d{3,}$/.test(token) || /^[A-Z]{3,}$/.test(token)));
  return [...new Set([text, ...subjectTokens].filter(Boolean))];
}

/**
 * 图库搜索的"降噪"词表：这些词让查询从 12 张变成 0 张（实测）。
 * 图库按对象检索，形容词会被当成额外的必需词。
 */
const IMAGE_QUERY_STOPWORDS = new Set([
  // 介词与虚词
  'a', 'an', 'the', 'of', 'with', 'on', 'in', 'at', 'by', 'for', 'to', 'from', 'and', 'or',
  'into', 'over', 'under', 'near', 'inside', 'outside', 'around',
  // 氛围与风格形容词
  'minimal', 'minimalist', 'modern', 'luxury', 'luxurious', 'elegant', 'premium',
  'dark', 'light', 'bright', 'moody', 'glowing', 'glow', 'neon', 'vibrant', 'colorful',
  'soft', 'warm', 'cool', 'clean', 'simple', 'bold', 'cozy', 'cinematic', 'dramatic',
  'abstract', 'aesthetic', 'futuristic', 'retro', 'vintage', 'sleek', 'stunning',
  // 时间与场景修饰
  'night', 'day', 'evening', 'morning', 'sunset', 'sunrise', 'nighttime', 'daytime',
  // 摄影术语
  'long', 'exposure', 'close', 'closeup', 'wide', 'angle', 'shot', 'view', 'scene',
  'large', 'small', 'big', 'tiny', 'new', 'old', 'main', 'full', 'entire', 'whole', 'data',
  'photo', 'photograph', 'photography', 'image', 'picture', 'wallpaper', 'background',
  'high', 'low', 'blurred', 'sharp', 'detailed', 'detail', 'texture',
  // 动作（-ing 形式通常不能当检索对象）
  'working', 'sketching', 'reacting', 'glowing', 'standing', 'sitting', 'running',
]);

const BRAND_PATTERN = /\b(?:Toyota|Nissan|Honda|Mazda|Subaru|Mitsubishi|Porsche|BMW|Mercedes|Ford|Ferrari|Lamborghini|Volkswagen|Audi|Volvo|Peugeot|Renault|Hyundai|Kia|Tesla|Marvel|Disney)\b/i;

/**
 * 把长句压成 2-3 个具体名词。
 *
 * 不是简单地取前 N 个词 —— 那会得到 designer working at。
 * 而是先剔除形容词/介词/动名词，再保留最有检索价值的名词。
 */
export function shortenImageQuery(query, maxWords = 3) {
  const candidates = buildImageQueryCandidates(query, maxWords);
  return candidates[0] ?? '';
}

/**
 * 从长句生成按检索价值排序的短查询候选。
 *
 * 为什么不是简单截断：实测 `dark control room with large data dashboard screens`
 * 截前 3 个会得到 `control room large`（混进形容词），而真正能搜到图的是
 * `control room monitors`。所以要从保留词里枚举组合、按结构打分。
 *
 * 打分依据（全部来自实测对照）：
 *   + 品牌/车型编号        检索唯一性最高
 *   + 名词-名词组合        "coffee shop" / "stage lights" 命中率最高
 *   - 形容词在首位         "large dashboard" 不如 "dashboard screens"
 *   - 词数偏离 2          图库对 2 词查询最友好
 */
export function buildImageQueryCandidates(query, maxWords = 3) {
  const text = String(query ?? '').trim();
  if (!text) return [];
  // 中文不做英文式压缩（无空格分词），原样作为唯一候选
  if (!/[A-Za-z]/.test(text)) return [text];

  const words = text.split(/[\s,，、]+/).filter(Boolean);
  const kept = words.filter((w) => {
    const low = w.toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!low) return false;
    if (IMAGE_QUERY_STOPWORDS.has(low)) return false;
    if (low.length > 5 && low.endsWith('ing')) return false;
    return true;
  });
  if (!kept.length) return [];

  const score = (phrase) => {
    const parts = phrase.split(' ');
    let s = 0;
    // 词数越接近 2 越好；3 词次之
    if (parts.length === 2) s += 30;
    else if (parts.length === 3) s += 18;
    else s -= 10;
    for (const p of parts) {
      if (BRAND_PATTERN.test(p)) s += 60;
      else if (/[A-Za-z]+\d|[0-9][A-Za-z]/.test(p)) s += 40;
      // 首词是形容词性修饰时降权（large / data 这类做头词不如做尾词）
    }
    if (parts.length >= 2 && /^(?:large|small|big|tiny|new|old|main|full|high|low)$/i.test(parts[0])) s -= 15;
    return s;
  };

  const phraseCandidates = new Set();
  // 相邻二元组（保留原语序，语义最完整）
  for (let i = 0; i + 1 < kept.length; i += 1) phraseCandidates.add(`${kept[i]} ${kept[i + 1]}`);
  // 相邻三元组
  if (maxWords >= 3) {
    for (let i = 0; i + 2 < kept.length; i += 1) phraseCandidates.add(`${kept[i]} ${kept[i + 1]} ${kept[i + 2]}`);
  }
  // 首词 + 末词（跨距组合常能救回 "neon ... stage" → "neon stage"）
  if (kept.length >= 3) phraseCandidates.add(`${kept[0]} ${kept[kept.length - 1]}`);

  const ranked = [...phraseCandidates]
    .filter((p) => p !== text)
    .map((p) => ({ p, s: score(p) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.p);
  // 去重且保持顺序
  return [...new Set(ranked)];
}

function imageSearchQueryCascade(query) {
  const text = String(query ?? '').trim();
  const modelAnchors = text.match(/\b(?:[A-Za-z]+\d+[A-Za-z0-9-]*|\d+[A-Za-z][A-Za-z0-9-]*)\b/g) ?? [];
  const make = BRAND_PATTERN.exec(text)?.[0];
  const english = extractEnglishTokens(text);
  const queries = [text, english];
  for (const anchor of modelAnchors) {
    if (make) queries.push(`${make} ${anchor}`);
    queries.push(anchor);
  }
  // 长短兜底：模型写好长句时，用压缩后的 2-3 个名词再试一次
  const shortened3 = shortenImageQuery(text, 3);
  const shortened2 = shortenImageQuery(text, 2);
  if (shortened3) queries.push(shortened3);
  if (shortened2 && shortened2 !== shortened3) queries.push(shortened2);
  return [...new Set(queries.map((item) => item.trim()).filter(Boolean))];
}

function imageCandidateRelevance(candidate, query) {
  const title = String(candidate?.title ?? '').toLocaleLowerCase();
  const page = String(candidate?.page ?? '').toLocaleLowerCase();
  const metadata = `${title} ${page}`;
  const generic = new Set(['photo', 'photos', 'photograph', 'photography', 'image', 'images', 'picture', 'pictures', 'real', 'authentic', 'view', 'angle', 'close', 'up', 'scene', 'detail', 'distinct', 'composition', 'wide', 'with', 'from', 'that', 'this', 'and', 'the', 'for', 'on', 'at', 'of']);
  const tokens = String(query ?? '').match(/[\u4e00-\u9fff]{2,}|[A-Za-z0-9][A-Za-z0-9'-]{2,}/g) ?? [];
  const unique = [...new Set(tokens.map((token) => token.toLocaleLowerCase()).filter((token) => !generic.has(token)))];
  return unique.reduce((score, token) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const isCjk = /[\u4e00-\u9fff]/.test(token);
    const hit = isCjk
      ? title.includes(token) || page.includes(token)
      : new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(title)
        || new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(page);
    if (!hit) return score;
    const anchor = /\d/.test(token) ? 8 : token.length >= 5 ? 3 : 1;
    return score + anchor * (title.includes(token) ? 2 : 1);
  }, 0);
}

const IMAGE_SCENE_CUES = [
  { request: /\b(?:front|frontal|headlights?|headlamps?)\b|前脸|车头|大灯|翻灯/i, evidence: /\b(?:front|frontal|headlights?|headlamps?)\b|前脸|车头|大灯|翻灯/i },
  { request: /\b(?:side|profile|side-on)\b|侧面|侧视/i, evidence: /\b(?:side|profile|side-on)\b|侧面|侧视/i },
  { request: /\b(?:rear|back|tail lights?)\b|车尾|尾灯|后视/i, evidence: /\b(?:rear|back|tail lights?)\b|车尾|尾灯|后视/i },
  { request: /\b(?:interior|dashboard|cockpit|steering wheel)\b|内饰|仪表盘|驾驶舱|方向盘/i, evidence: /\b(?:interior|dashboard|cockpit|steering wheel)\b|内饰|仪表盘|驾驶舱|方向盘/i },
  { request: /\b(?:drift|drifting)\b|漂移/i, evidence: /\b(?:drift|drifting)\b|漂移/i },
  { request: /\b(?:night|nighttime|at night)\b|夜间|夜晚|夜色/i, evidence: /\b(?:night|nighttime|at night)\b|夜间|夜晚|夜色/i },
  { request: /\b(?:mountain road|winding road|mountain pass)\b|山道|盘山路|山路/i, evidence: /\b(?:mountain|winding road|mountain pass|mountain road)\b|山道|盘山路|山路/i },
  { request: /\b(?:parking lot|parked|parking)\b|停车场|停放/i, evidence: /\b(?:parking lot|parked|parking)\b|停车场|停放/i },
];

function hasUnsupportedSceneDetails(candidate, query) {
  const metadata = `${candidate?.title ?? ''} ${candidate?.page ?? ''}`;
  return IMAGE_SCENE_CUES.some(({ request, evidence }) => request.test(String(query ?? '')) && !evidence.test(metadata));
}

function sourceTitle(candidate) {
  return String(candidate?.title ?? '')
    .replace(/\.(?:jpe?g|png|webp|gif|avif)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 判断查询是否在找「具体人物/角色」。只在人物类查询上启用素材类型偏好。
 */
function looksLikePersonQuery(query) {
  const q = String(query ?? '');
  const hasLatinName = /\b[A-Z][a-z]+(?:[ -][A-Z][a-z]+)+\b/.test(q) || /\b(?:Marvel|Avengers|X-Men)\b/i.test(q);
  const hasCjkRole = /[\u4e00-\u9fff]{1,4}(?:侠|队长|博士|王|人|神)/.test(q);
  return hasLatinName || hasCjkRole;
}

/**
 * 人物/角色图的素材类型分层：2=official, 1=neutral, 0=weak。
 * weak 不是不能用，只是排在后面 —— 搜不到更好的时候它仍比矢量插画强。
 */
/**
 * 从搜索词推导 Wikipedia 条目名候选（仅用于人物/角色查询）。
 *
 * 例："Gamora Marvel" → ["Gamora"]；"Iron Man armor" → ["Iron Man", "Iron"]
 * 不做别名猜测 —— 映射错了会拿到完全不相干的条目。
 */
const FRANCHISE_WORDS = new Set(['Marvel', 'DC', 'Disney', 'Pixar', 'Star', 'Wars', 'Avengers', 'X-Men', 'XMen', 'Guardians', 'Galaxy', 'Comics', 'Comic', 'Universe', 'MCU', 'Studios']);

function wikipediaTitleCandidates(query) {
  const tokens = String(query ?? '').split(/[\s,]+/).filter(Boolean);
  const leading = [];
  for (const t of tokens) {
    if (/^[A-Z]/.test(t)) leading.push(t);
    else break;
  }
  const cleaned = leading.filter((t) => !FRANCHISE_WORDS.has(t.replace(/[^A-Za-z-]/g, '')));
  const out = [];
  if (cleaned.length >= 2) out.push(cleaned.slice(0, 3).join(' '));
  if (cleaned.length >= 1) out.push(cleaned[0]);
  const full = cleaned.join(' ');
  if (full && !out.includes(full)) out.push(full);
  return [...new Set(out.filter(Boolean))].slice(0, 3);
}

function personaAssetTier(candidate) {
  const meta = `${candidate?.cand?.title ?? candidate?.title ?? ''} ${candidate?.cand?.page ?? candidate?.page ?? ''}`;
  if (/\b(?:official|marvel studios|movie still|film still|promotional|press photo|character poster|comic cover)\b|官方|剧照|海报|漫画封面/i.test(meta)) return 2;
  if (/\b(?:cosplay|costume contest|statue|figurine|action figure|toy|graffiti|mural|billboard|storefront|merchandise|shelf|poster shop)\b|cosplay|手办|人偶|涂鸦|墙绘|广告牌|周边|商品/i.test(meta)) return 0;
  return 1;
}

/**
 * 查询里的「区分词」：能把这个角色和同名角色/同名事物区分开。
 *
 * 例："Captain Marvel Marvel" 里的 Marvel —— 没有它就会搜到
 * 1940 年代另一家公司的 Captain Marvel 老照片。
 */
const DISAMBIGUATORS = ['marvel', 'dc', 'avengers', 'x-men', 'xmen', 'mcu', 'disney', 'pixar', 'star wars', 'guardians'];

function disambiguatorsIn(query) {
  const q = String(query ?? '').toLowerCase();
  return DISAMBIGUATORS.filter((d) => q.includes(d));
}

function imageCandidateUsable(candidate, query = '') {
  const { width = 0, height = 0 } = candidate?.dims?.tech ?? {};
  const visualIntent = /\b(?:illustration|diagram|icon|vector|drawing|artwork)\b|插画|示意图|图标|矢量|绘画/i.test(query);
  const metadata = `${candidate?.cand?.title ?? candidate?.title ?? ''} ${candidate?.cand?.page ?? candidate?.page ?? ''}`;
  const disallowed = visualIntent ? /\b(?:ai[- ]?generated|watermark|wallpaper|logo|clipart)\b|人工智能生成|水印|壁纸|标志/i
    // 手办/周边类素材：即使查询词带了 figure，也一律拒收 ——
    // 实测这类图会让「黑豹」卡位出现古希腊陶罐、「蜘蛛侠」出现出租车旁玩偶。
    : /\b(?:ai[- ]?generated|wallpaper|logo|clipart|vector|illustration|concept art|render(?:ed|ing)?|figurine|action figure|model kit|collectible|statue|toy|merchandise|bobblehead|amigurumi)\b|人工智能生成|壁纸|标志|矢量插画|手办|人偶|模型套件|周边/i;
  const nonPhotoGameAsset = /\b(?:ETS2|ATS|Euro Truck Simulator|American Truck Simulator|Assetto Corsa|Forza Horizon|Gran Turismo|BeamNG|CarX Drift|GTA V)\b|游戏截图|游戏模组|模组下载|3D 模型下载/i.test(metadata);
  const modelAnchors = String(query).match(/\b(?:[A-Za-z]+\d+[A-Za-z0-9-]*|\d+[A-Za-z][A-Za-z0-9-]*)\b/g) ?? [];
  const hasExactModelAnchor = modelAnchors.length === 0 || modelAnchors.some((anchor) => {
    const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?:$|[^A-Za-z0-9])`, 'i').test(metadata);
  });
  // 区分词约束：查询里带 Marvel/DC 这类限定词时，候选也必须带，
  // 否则会混进同名角色（如 1940 年代的 Captain Marvel 老照片）。
  const disambig = disambiguatorsIn(query);
  const disambigOk = disambig.length === 0 || disambig.some((d) => metadata.toLowerCase().includes(d));

  return !disallowed.test(metadata)
    && !nonPhotoGameAsset
    && disambigOk
    && hasExactModelAnchor
    && candidate?.dims?.content?.level === 'strong'
    && candidate?.dims?.tech?.score > 0
    && Math.min(width, height) >= 360
    && width * height >= 640 * 360;
}

export async function runPipeline(requirement, styleId, fxLevel, projectTitle, styleDescription, onPhase, llmChoice = 'auto', choiceParams = {}, requiredRequirementIds = []) {
  const sentence = requirement;
  const projectId = 'P' + Date.now().toString(36).toUpperCase();
  const ws = path.join(WORKSPACES, projectId);
  fs.mkdirSync(path.join(ws, 'test'), { recursive: true });

  let spec = parseSentence(`${projectTitle ?? ''} ${requirement}`.trim(), { styleId, fxLevel, styleDescription });
  if (projectTitle) spec.title = projectTitle;

  // ---- 用户开工前选择 = 硬约束（不可被 detectStyle / LLM / 默认值静默覆盖）----
  const lockedChoices = { ...(choiceParams ?? {}) };
  if (lockedChoices.styleId) {
    spec.styleId = lockedChoices.styleId;
    spec.styleLocked = true;
  }
  if (lockedChoices.font) {
    spec.fontMood = lockedChoices.font;
    spec.fontLocked = true;
  }
  if (lockedChoices.direction) {
    spec.pageDirection = lockedChoices.direction;
    spec.directionLocked = true;
  }
  // 把锁定的字体气质写进自由描述，让风格引擎的六维解析也遵守（serif→衬线）
  if (lockedChoices.font) {
    const label = { serif: '衬线', sans: '无衬线', mono: '等宽' }[lockedChoices.font];
    spec.styleDescription = `${spec.styleDescription ?? ''} ${label}标题`.trim();
  }
  onPhase?.('解析需求与风格…');
  const cues = [];
  const emit = (d, events) => cues.push({ d, events });

  // ---- P4 Model Gateway：配置了 LLM Key 则用 AI 理解需求（失败安全回退规则） ----
  const gw = pickGateway(llmChoice);
  // 创作型 PagePlan 为默认路径；仅在显式设置 ORCHESTRAI_PAGEPLAN=off 时退回旧模板。
  // 否则意图解析会把 PagePlan 形状的回复判为"数据集不完整"并提前把作业标记失败。
  const usePagePlan = process.env.ORCHESTRAI_PAGEPLAN !== 'off';

  // ---- 内测版硬约束：必须使用用户自定义模型 ----
  // 理由：无模型时只能产模板化低质页面，与"按需创作"目标相悖，故直接阻断而非静默降级。
  if (!gw) {
    const reason = llmChoice === 'rule'
      ? '内测版要求使用自定义 API 模型：当前选择了「规则识别」模式，只能产出模板页。请在 🔑 主模型面板配置自己的 API（地址 + Key + 模型名）后重试。'
      : '内测版要求使用自定义 API 模型：未检测到可用模型配置。请在 🔑 主模型面板填入你自己的 API 地址、Key 与模型名后重试（无模型只能生成低质量模板网页，故不提供降级生成）。';
    emit(180, [
      { type: 'log', level: 'error', from: 'supervisor', message: `⛔ ${reason}` },
      { type: 'gate_result', gate: 'model_required', passed: false, detail: reason },
      { type: 'task_status_changed', taskId: 'T0', from: 'pending', to: 'blocked', reason: '缺少用户自定义模型配置' },
    ]);
    persistProject(cues, {
      projectId, spec, sentence, files: {}, ws, projectTitle,
      delivered: false, deliveryVersion: null, previewUrl: null,
      testSummary: reason, hadDefectFix: false, firstOk: false,
    });
    return { projectId, cues, previewUrl: null, workspace: ws, failed: true, blocked: 'model_required', reason };
  }

  if (gw && !usePagePlan) {
    onPhase?.(`AI 理解需求中（${gw.label ?? gw.provider}/${gw.model}）…`);
    // 统一重试保险：① 调用异常（网络/限流/JSON 截断解析失败）② 解析成功但数据集不完整（atlas 对象空 / gallery 图鉴 items 空）
    // —— 最多两次尝试，第二次仍不行才回退规则识别
    const needsDataset = (it) => (it.type === 'atlas' && (!it.atlas || (it.atlas.objects ?? []).length < 3))
      || (it.type === 'gallery' && !it.gallery?.items?.length && /图鉴|介绍|百科|全部|所有|成员|历代|系列|阵容|角色/.test(requirement));
    let intent = null;
    let lastErr = null;
    for (let attempt = 1; attempt <= 2 && !intent; attempt++) {
      try {
        const it = await parseIntentWithLLM(requirement, projectTitle ?? '', gw, spec);
        if (attempt === 1 && needsDataset(it)) {
          cues.push({ d: 210, events: [
            { type: 'log', level: 'warn', from: 'supervisor', message: `AI 返回的数据集不完整（${it.type === 'atlas' ? '图谱对象为空' : '图鉴清单为空'}），自动重试一次…` },
          ] });
          continue; // 第二次无论完整性如何都接受（优于回退规则识别）
        }
        intent = it;
      } catch (e) {
        lastErr = e;
        if (attempt === 1) {
          cues.push({ d: 205, events: [
            { type: 'log', level: 'warn', from: 'supervisor', message: `模型调用失败（${String(e?.message ?? e).slice(0, 90)}），自动重试一次…` },
          ] });
        }
      }
    }
    if (intent) {
      const nextTpl = TEMPLATES[intent.type];
      if (nextTpl) spec.template = nextTpl;
      spec.type = intent.type;
      if (!projectTitle) spec.title = intent.title;
      spec.features = intent.features;
      spec.matchedBy = `AI 理解（${intent.llmProvider}）`;
      if (intent.type === 'gallery' && intent.subject) spec.galleryQuery = intent.subject;
      if (intent.type === 'gallery' && intent.gallery && (intent.gallery.items ?? []).length >= 4) {
        spec.galleryItems = intent.gallery.items;
        if (!spec.galleryQuery) spec.galleryQuery = intent.gallery.items[0].name;
      }
      if (intent.type === 'landing' && intent.landing) spec.landing = intent.landing;
      if (intent.type === 'atlas') spec.atlas = intent.atlas;
      // AI 视觉设计：用户未显式选风格、需求关键词也未命中目录 → 用 LLM 为主题定制的设计简报
      // 优先级：用户显式风格 > 需求文本关键词 > AI 设计 > 默认兜底
      if (intent.design?.desc && !styleDescription && !spec.styleId) {
        spec.styleDescription = intent.design.desc;
        spec.styleDesign = true;
        cues.push({ d: 215, events: [
          { type: 'agent_state_changed', role: 'designer', status: 'analyzing', detail: `AI 视觉设计：${intent.design.desc.slice(0, 50)}` },
          { type: 'log', level: 'info', from: 'designer', message: `🎨 AI 视觉设计师为主题定制风格：${intent.design.desc.slice(0, 70)}` },
        ] });
      }
      spec.viaLLM = true;
      spec.llmProvider = intent.llmProvider;
      // ---- 阶段二任务 B：完整 Design Brief（landing 类）——双方向+schema 校验，失败回退旧简报路径
      if (intent.type === 'landing' && !spec.designLayout) {
        try {
          onPhase?.('AI 首席设计师正在撰写 Design Brief（双方向）…');
          const { brief, notes, callMeta } = await generateBrief(requirement, projectTitle ?? spec.title, gw);
          spec.designBrief = brief;
          spec.designLayout = pickLayout(brief);
          spec.designBriefMeta = { ms: callMeta.ms, retries: callMeta.retries, parseOk: callMeta.parseOk, notes };
          cues.push({ d: 218, events: [
            { type: 'agent_state_changed', role: 'designer', status: 'analyzing', detail: `Design Brief：${brief.directions.map((d) => d.name).join(' / ')} → 选定 ${spec.designLayout ?? 'pageShell 回退'}` },
            { type: 'log', level: 'info', from: 'designer', message: `📐 Design Brief 完成（${callMeta.ms}ms，重试${callMeta.retries}）：方向A「${brief.directions[0].name}·${brief.directions[0].layoutStrategy}」/ 方向B「${brief.directions[1].name}·${brief.directions[1].layoutStrategy}」${notes.length ? `；规范化：${notes[0].slice(0, 40)}` : ''}` },
          ] });
        } catch (e) {
          spec.designLayout = null;
          spec.designBriefMeta = { failed: String(e?.message ?? e).slice(0, 140) };
          cues.push({ d: 219, events: [
            { type: 'log', level: 'warn', from: 'designer', message: `⚠ Design Brief 未通过校验，布局回退 pageShell：${String(e?.message ?? e).slice(0, 110)}` },
          ] });
        }
      }
    } else {
      // 内测版硬约束：模型是本产品的核心能力，调用失败不得回退规则生成模板页。
      // 回退会让用户拿到"看起来完成、实际是低质模板"的产物，比失败更糟。
      spec.viaLLM = false;
      spec.llmFallbackReason = String(lastErr?.message ?? lastErr ?? '两次尝试均未返回有效数据集').slice(0, 200);
      emit(200, [
        { type: 'log', level: 'error', from: 'supervisor', message: `⛔ 模型调用失败，已终止（内测版不回退模板）：${spec.llmFallbackReason}` },
        { type: 'gate_result', gate: 'model_required', passed: false, detail: `模型调用失败：${spec.llmFallbackReason.slice(0, 120)}` },
        { type: 'task_status_changed', taskId: 'T0', from: 'pending', to: 'blocked', reason: '模型调用失败' },
      ]);
      persistProject(cues, {
        projectId, spec, sentence, files: {}, ws, projectTitle,
        delivered: false, deliveryVersion: null, previewUrl: null,
        testSummary: `模型调用失败，未生成任何页面：${spec.llmFallbackReason.slice(0, 140)}`,
        hadDefectFix: false, firstOk: false,
      });
      return {
        projectId, cues, previewUrl: null, workspace: ws, failed: true,
        blocked: 'model_failed',
        reason: `模型调用失败：${spec.llmFallbackReason}。请在 🔑 主模型面板检查 API Key 额度/有效性后重试。`,
      };
    }
  }
  if (spec.type !== 'gallery') delete spec.galleryQuery;

  const styleDef = getStyleDef(spec);
  spec.styleDef = styleDef;
  // 风格来源审计：用户锁定 > 需求关键词/LLM 推断 > 默认
  const styleOrigin = spec.styleLocked ? 'user-locked' : (spec.styleId ? 'auto-detected' : 'default');
  spec.styleOrigin = styleOrigin;
  if (spec.styleLocked && styleDef.id !== spec.styleId) {
    // 引擎没能解析出用户选的风格 = 硬约束失效，宁可如实报错也不静默降级
    throw new Error(`用户指定的视觉风格「${spec.styleId}」无法被风格引擎解析（得到 ${styleDef.id}），已终止以免交付错误设计`);
  }
  cues.push({ d: 150, events: [
    { type: 'log', level: 'info', from: 'designer', message: `风格「${styleDef.name}」已就绪（来源：${{ 'user-locked': '用户在开工前指定', 'auto-detected': '按需求自动识别', default: '默认' }[styleOrigin]}）` },
  ] });
  onPhase?.(`风格「${styleDef.name}」已就绪`);
  const usage = (i, o, c) => ({ inputTokens: i, outputTokens: o, costUsd: c });

  // ---- 展馆类型：先执行真实网络素材采集（designer 角色） ----
  // PagePlan 模式下素材由模型在节点树中直接声明，旧图源采集链不参与（否则会用模板图覆盖模型选择）。
  if (spec.type === 'gallery' && !usePagePlan) {
    const keys = getKeys();
    const items = spec.galleryItems ?? [];
    if (items.length >= 4) {
      // ---- 图鉴模式：LLM 已产出对象清单（名称/副题/介绍/配图搜索词）→ 逐对象定向采集 ----
      emit(300, [
        { type: 'agent_state_changed', role: 'designer', status: 'analyzing', detail: `图鉴模式：${items.length} 个对象，逐一定向配图并保留介绍` },
      ]);
      emit(400, [
        { type: 'agent_run_started', runId: 'R-00', taskId: 'T1', role: 'designer', model: { provider: 'web', modelId: 'image-collector-v1' } },
        { type: 'agent_step', runId: 'R-00', taskId: 'T1', role: 'designer', step: { at: 0, kind: 'tool', tool: 'web_search', detail: `为每个对象定向搜索配图（${items[0].name}、${items[1]?.name ?? ''}… 共 ${items.length} 个，Pexels → Unsplash → Bing → Reddit → DuckDuckGo → Wikimedia 链）` } },
      ]);
      let done = 0, okCount = 0;
      const noPhotoNames = [];
      // 查询级联采集：全名 → LLM 词 → 英文名 → 前缀截断 → 本名；每级取 3 候选交策展器四维评分。
      // 内容维度须 strong（完整词命中）才采用（弱命中=无把握，不猜）；策略与阶段一 strict 等效并叠加 tech/visual/source 维。
      const collectOne = async (it) => {
        const targets = [it.name, extractEnglishTokens(it.query || '')].filter(Boolean);
        for (const q of queryCascade(it)) {
          const r = await collectImages({ query: q, count: 3, keys });
          if (r.images.length > 0) {
            const { ranked } = rankCandidates(r.images, { targets });
            const top = ranked[0];
            if (top && top.dims.content.level === 'strong' && top.dims.tech.score > 0) {
              return { ...top.cand, buf: top.cand.buf, curatorReasons: top.reasons, curatorTotal: top.total };
            }
          }
          await new Promise((r2) => setTimeout(r2, 700));
        }
        const en = extractEnglishTokens(it.query || '');
        if (en) {
          const r = await collectImages({ query: it.name, count: 1, keys, wikiTitle: en });
          if (r.images.length > 0) return r.images[0];
        }
        return null;
      };
      // 图片资产锁定复用（阶段二升级为图位语义解析）：名称变但语义同→复用；语义变→拒绝并保留 retired 记录。
      // 开关：ORCHESTRAI_IMAGE_LOCK=off 关闭（回滚通道）。
      const lockOn = process.env.ORCHESTRAI_IMAGE_LOCK !== 'off';
      const assetKey = projectTitle || spec.title || projectId;
      const prevAssets = lockOn ? loadAssets(assetKey) : { version: 1, entries: [] };
      let reuseCount = 0;
      const slotStats = { reuse: 0, 'semantic-change': 0, 'source-missing': 0, 'hash-mismatch': 0, 'no-match': 0 };
      const retiredNames = [];
      const results = await mapPool(items, 2, async (it) => {
        if (lockOn) {
          const r = resolveSlot(prevAssets, { name: it.name, en: extractEnglishTokens(it.query || it.name) });
          slotStats[r.status] = (slotStats[r.status] ?? 0) + 1;
          if (r.status === 'reuse') { reuseCount++; okCount++; return r.img; }
          if (r.status === 'semantic-change') retiredNames.push(it.name);
        }
        const got = await collectOne(it);
        done++;
        if (got) okCount++;
        else noPhotoNames.push(it.name);
        onPhase?.(`正在为「${it.name}」采集照片（${done}/${items.length}）${got ? '' : ' · 未获照片将用示意卡'}`);
        return got;
      });
      // 文件命名：复用资产保留原文件名并预占；新采集递增序号并跳过已占用名
      // （真实缺陷修复：同名覆盖曾致 images.js 引用缺失文件，被渲染门禁检出）
      const usedNames = new Set(items.map((it, i) => (results[i]?.reused ? results[i].file : null)).filter(Boolean));
      let seq = 1;
      spec.images = items.map((it, i) => {
        const got = results[i];
        const base = { title: it.name, sub: it.sub, desc: it.desc };
        if (got) {
          let file;
          if (got.reused) {
            file = got.file;
          } else {
            do { file = `images/img-${String(seq).padStart(2, '0')}.${got.ext}`; seq++; } while (usedNames.has(file));
          }
          usedNames.add(file);
          return {
            ...base,
            file,
            author: got.author.slice(0, 60), license: got.license.slice(0, 40), page: got.page,
            buf: got.buf,
          };
        }
        let file;
        do { file = `images/card-${String(seq).padStart(2, '0')}.png`; seq++; } while (usedNames.has(file));
        usedNames.add(file);
        return {
          ...base,
          file,
          author: 'OrchestrAI 本地生成', license: '生成内容', page: '',
          buf: placeholderCard(800, 600, spec.template.meta.accent, i),
        };
      });
      // 资产注册表落盘：真实网络照片记为锁定资产（slotKey/en/来源工作区/许可/理由/时间/sha1）；
      // 语义变化的旧条目标记 retired 保留（不删除不覆盖）；示意卡不入锁。
      if (lockOn) {
        const fresh = items
          .map((it, i) => (results[i] && !results[i].reused ? assetEntry(spec.images[i], {
            provider: spec.provider ?? '',
            reason: results[i].curatorReasons ? `策展评分 ${results[i].curatorTotal}：${results[i].curatorReasons.join('；').slice(0, 140)}` : `对象「${it.name}」维基权威肖像兜底`,
            srcWs: path.basename(ws),
            slotKey: undefined,
            en: extractEnglishTokens(it.query || it.name),
          }) : null))
          .filter(Boolean);
        const reusedNames = new Set(items.filter((it, i) => results[i]?.reused).map((it) => it.name));
        const kept = (prevAssets.entries ?? []).filter((e) => reusedNames.has(e.title));
        const retired = (prevAssets.entries ?? [])
          .filter((e) => retiredNames.includes(e.title))
          .map((e) => ({ ...e, locked: false, status: 'retired', retiredAt: new Date().toISOString() }));
        saveAssets(assetKey, { version: 1, entries: [...kept, ...fresh, ...retired] });
      }
      spec.provider = `定向采集 ${okCount}/${items.length}${reuseCount ? `（复用已锁定 ${reuseCount}）` : ''}`;
      spec.imageSource = okCount > 0 ? 'network' : 'placeholder';
      const totalBytes = spec.images.reduce((a, i) => a + i.buf.length, 0);
      emit(500, [
        { type: 'log', level: okCount === items.length ? 'success' : 'info', from: 'designer', message: `图鉴采集完成：${okCount}/${items.length} 个对象获得真实网络照片（共 ${(totalBytes / 1024 / 1024).toFixed(1)}MB，策展四维评分）${lockOn ? `；图位解析：复用${slotStats.reuse} 新采${slotStats['no-match']} 语义变更${slotStats['semantic-change']} 源丢失${slotStats['source-missing']}${retiredNames.length ? `（retired：${retiredNames.join('、')}）` : ''}` : ''}${noPhotoNames.length ? `；未获照片（已用示意卡保留介绍）：${noPhotoNames.join('、')}` : ''}` },
      ]);
      emit(260, [
        { type: 'agent_run_ended', runId: 'R-00', taskId: 'T1', status: 'succeeded', usage: usage(400, 100, 0.01) },
        { type: 'agent_state_changed', role: 'designer', status: 'idle' },
      ]);
      spec.extraAssets = ['images.js', ...spec.images.map((i) => i.file)];
    } else {
      const query = spec.galleryQuery || extractSubject(sentence);
      spec.galleryQuery = query;
      emit(300, [
        { type: 'agent_state_changed', role: 'designer', status: 'analyzing', detail: `确定素材采集方案：主题「${query}」` },
      ]);
      emit(400, [
        { type: 'agent_run_started', runId: 'R-00', taskId: 'T1', role: 'designer', model: { provider: 'web', modelId: 'image-collector-v1' } },
        { type: 'agent_step', runId: 'R-00', taskId: 'T1', role: 'designer', step: { at: 0, kind: 'tool', tool: 'web_search', detail: `搜索网络图源（已配置的 Pexels / Unsplash 优先，其后 Bing、Reddit、DuckDuckGo 与 Wikimedia）` } },
      ]);
      onPhase?.(`正在联网采集「${query}」照片…`);
      let scraped = await collectImages({ query, count: 10, keys });
      if (scraped.images.length > 0) {
        let selectedImages = [];
        const skippedProviders = new Set();
        for (let sourcePass = 0; sourcePass < 4; sourcePass++) {
          const { ranked } = rankCandidates(scraped.images, { targets: imageSearchTargets(query) });
          selectedImages = ranked.filter(imageCandidateUsable).map((candidate) => candidate.cand);
          if (selectedImages.length || !scraped.provider || scraped.provider === 'none') break;
          skippedProviders.add(scraped.provider);
          scraped = await collectImages({ query, count: 10, keys, skipProviders: [...skippedProviders] });
          if (!scraped.images.length) break;
        }
        if (!selectedImages.length) {
          emit(400, [
            { type: 'log', level: 'warn', from: 'designer', message: `搜索结果未通过主题相关性与清晰度筛选（${query.slice(0, 80)}）；使用明确标注的本地示意卡，不把弱匹配图片当真实素材。` },
          ]);
        }
        const chosenImages = selectedImages.length ? selectedImages : [];
        if (chosenImages.length) {
          const totalBytes = chosenImages.reduce((a, i) => a + i.buf.length, 0);
          emit(500, [
            { type: 'log', level: 'success', from: 'designer', message: `图源 ${scraped.provider} 采集成功：${chosenImages.length} 张通过相关性与清晰度筛选（共 ${(totalBytes / 1024 / 1024).toFixed(1)}MB），全部下载到工作区并保留署名` },
          ]);
          spec.images = chosenImages.map((img, i) => ({
            file: `images/img-${String(i + 1).padStart(2, '0')}.${img.ext}`,
            title: img.title.slice(0, 60), author: img.author.slice(0, 60),
            license: img.license.slice(0, 40), page: img.page,
          }));
          spec.images.forEach((m, i) => { m.buf = chosenImages[i].buf; });
          spec.provider = scraped.provider;
          spec.imageSource = 'network';
        } else {
          spec.images = Array.from({ length: 6 }, (_, i) => ({
            file: `images/card-${String(i + 1).padStart(2, '0')}.png`,
            title: `${query} · 示意卡 ${i + 1}`,
            author: 'OrchestrAI 本地生成', license: '生成内容', page: '',
            buf: placeholderCard(800, 600, spec.template.meta.accent, i),
          }));
          spec.provider = '本地示意卡';
          spec.imageSource = 'placeholder';
        }
      } else {
        // 诚实兜底：网络不可达 → 本地程序化示意卡（标签明示）
        emit(400, [
          { type: 'log', level: 'warn', from: 'designer', message: `网络图源不可达（${scraped.errors.slice(0, 2).join('；')}）→ 生成 6 张本地示意卡代替，并在已知限制中披露` },
        ]);
        spec.images = Array.from({ length: 6 }, (_, i) => ({
          file: `images/card-${String(i + 1).padStart(2, '0')}.png`,
          title: `${query} · 示意卡 ${i + 1}`,
          author: 'OrchestrAI 本地生成', license: '生成内容', page: '',
          buf: placeholderCard(800, 600, spec.template.meta.accent, i),
        }));
        spec.provider = '本地示意卡';
        spec.imageSource = 'placeholder';
      }
      emit(260, [
        { type: 'agent_run_ended', runId: 'R-00', taskId: 'T1', status: 'succeeded', usage: usage(400, 100, 0.01) },
        { type: 'agent_state_changed', role: 'designer', status: 'idle' },
      ]);
      spec.extraAssets = ['images.js', ...spec.images.map((i) => i.file)];
    }
  }

  // ============================================================
  // PagePlan 可组合渲染路径（默认启用）
  // 回滚开关：仅 ORCHESTRAI_PAGEPLAN=off 时使用旧模板路径。
  // 铁律：PagePlan 失败 → 直接阻断交付，绝不回退 parseSentence / pageShell。
  // ============================================================
  let files;
  let pagePlanReport = null;
  let pagePlanExpect = null;
  if (usePagePlan) {
    // 真实阶段进度（M7-B4C）：每一阶段都对应真实完成的工作，不伪造百分比。
    onPhase?.('理解需求与创作意图…');
    emit(400, [
      { type: 'agent_state_changed', role: 'frontend', status: 'working', taskId: 'T1', detail: '由模型产出结构化 PagePlan（节点树决定布局）' },
      { type: 'log', level: 'info', from: 'frontend', message: '🧩 启用 PagePlan 路径：模型直接决定页面结构与组成，而非只填数据' },
    ]);
    try {
      onPhase?.('创作规划 + 场景生成（Scene Brief → PagePlan，单次调用）…');
      const planResult = await generatePagePlan({
        requirement,
        projectTitle: projectTitle ?? spec.title,
        gw,
        userChoices: {
          styleId: spec.styleLocked ? spec.styleId : undefined,
          fontMood: spec.fontLocked ? spec.fontMood : undefined,
          pageDirection: spec.directionLocked ? spec.pageDirection : undefined,
        },
        allowedStyleIds: STYLE_CATALOG.map((c) => c.id),
        // scene3d 需显式开放（已在真实 Edge 32/32 + ZIP 18/18 验收）。
        // 是否真产出 3D 仍由模型依据需求决定；不开放就没有该能力。
        availableCapabilities: [...PAGEPLAN_BASE_CAPABILITIES, 'scene3d'],
        requiredRequirementIds,
        // 把每次尝试的失败写进事件流：否则"重试过"在产物与时间线里都不可见，
        // 只能靠请求计数反推（本轮 E2E 就卡在这条）。
        onAttempt: (info) => {
          // M7-B4D：把每一轮的**原始模型文本**落到工作区 _model/ 下。
          // 目的：事后能回答"JSON 为什么非法 / 模型到底写了什么"，而不是只有一句 reason。
          // _model/ 已在 packaging.isInternalLog 中排除，不会进交付 ZIP。
          if (typeof info.rawText === 'string' && info.rawText.length) {
            try {
              const dir = path.join(ws, '_model');
              fs.mkdirSync(dir, { recursive: true });
              fs.writeFileSync(path.join(dir, `attempt-${info.attempt}.txt`), info.rawText);
            } catch { /* 原始输出落盘失败不应影响主流程 */ }
          }
          if (info.ok) return;

          // M7-B4E：诊断字段可追踪，但不含密钥/Authorization/请求头/完整响应体。
          // 本轮真实故障只有一句 "This operation was aborted"，无法一眼看出是超时还是外部取消。
          const d = info.diagnostic ?? {};
          const bits = [];
          if (d.classification) bits.push("分类=" + d.classification);
          if (d.timedOut === true) bits.push("超时=是");
          else if (d.timedOut === false) bits.push("超时=否");
          if (Number.isFinite(d.elapsedMs)) bits.push("耗时=" + d.elapsedMs + "ms");
          if (d.enteredNetwork === false) bits.push("未进入网络");
          bits.push("可重试=" + (d.retryable ? "是" : "否"));
          if (d.willRetry !== undefined) bits.push("本次将重试=" + (d.willRetry ? "是" : "否"));
          const tail = info.willRetry ? "，自动重试一次…" : (info.retryable === false ? "，按失败类型不重试" : "，重试已用尽");
          emit(410, [
            { type: "log", level: "warn", from: "frontend", message: "⚠ PagePlan 第 " + info.attempt + "/" + info.attempts + " 次尝试失败（" + info.code + "）：" + String(info.issue ?? "").slice(0, 240) + "｜" + bits.join(" ") + tail },
          ]);
        },
        resolveTheme: async () => resolveThemeTokens({
          styleId: spec.styleLocked ? spec.styleId : (spec.styleId ?? 'editorial-obsidian'),
          fontMood: spec.fontLocked ? spec.fontMood : undefined,
          getStyleDef,
          catalog: STYLE_CATALOG,
          direction: spec.directionLocked ? spec.pageDirection : undefined,
        }),
        // 用 chatDetailed：把供应商真实 usage 带出来（chat 历史实现丢掉了 usage）
        callModel: chatDetailed,
      });
      // PagePlan image nodes may request a real image by searchQuery instead of
      // guessing a URL. Keep only semantically matched, technically usable files.
      const pagePlanImageFiles = new Map();
      const pagePlanImageCredits = new Map();
      const pagePlanImageProvenance = [];
      const pagePlanImageOmissions = [];
      const pagePlanImageFallbacks = [];
      const imageFallbackReason = new Map();
      const textOnlyRequest = assessPagePlanVisualComposition(planResult.plan, requirement).textOnly;
      const plannedImageNodes = collectImageNodes(planResult.plan);
      if (textOnlyRequest) {
        for (const node of plannedImageNodes) node.src = '';
      } else {
        for (const node of plannedImageNodes) {
          const src = String(node.src ?? '').trim();
          const existingLocal = src && !/^https:\/\//i.test(src) && fs.existsSync(path.join(ws, src));
          if (existingLocal) {
            const buf = fs.readFileSync(path.join(ws, src));
            pagePlanImageFiles.set(src, buf);
            pagePlanImageProvenance.push({ nodeId: node.id, query: node.searchQuery ?? '', provider: 'existing workspace asset', file: src, bytes: buf.length, title: node.alt ?? '', author: '项目素材', license: '用户提供', page: '', src });
            continue;
          }
          if (!String(node.searchQuery ?? '').trim()) {
            node.searchQuery = `${planResult.plan.meta.title} ${node.alt ?? ''} ${requirement}`.replace(/\s+/g, ' ').slice(0, 240);
          }
          node.src = '';
        }
      }
      const queryGroups = new Map();
      const seenImageQueries = new Map();
      if (!textOnlyRequest) {
        for (const node of plannedImageNodes) {
          if (pagePlanImageFiles.has(String(node.src ?? ''))) continue;
          let query = String(node.searchQuery ?? '').trim();
          if (!query) continue;
          const normalizedQuery = query.toLocaleLowerCase();
          const occurrence = (seenImageQueries.get(normalizedQuery) ?? 0) + 1;
          seenImageQueries.set(normalizedQuery, occurrence);
          if (occurrence > 1) {
            const suffix = ` ${String(node.alt ?? '').slice(0, 42)} distinct photo composition ${occurrence}`;
            query = `${query.slice(0, 240 - suffix.length)}${suffix}`.replace(/\s+/g, ' ');
            node.searchQuery = query;
          }
          const key = query.toLocaleLowerCase();
          const group = queryGroups.get(key) ?? { query, nodes: [] };
          group.nodes.push(node);
          queryGroups.set(key, group);
        }
      }
      const allImageSearchGroups = [...queryGroups.values()];
      // 图位上限：图鉴/名录类页面每个条目都要配图，8 个远远不够
      // （实测 12 个英雄的页面，第 9 个之后全被砍成矢量插画）。
      // 保留 24 的硬上限防止异常计划拖垮耗时与内存；超出部分如实标记，不假装有图。
      const IMAGE_SEARCH_LIMIT = 24;
      const imageSearchGroups = allImageSearchGroups.slice(0, IMAGE_SEARCH_LIMIT);
      const omittedImageSearchGroups = allImageSearchGroups.slice(IMAGE_SEARCH_LIMIT);
      for (const group of omittedImageSearchGroups) {
        for (const node of group.nodes) {
          node.src = '';
          imageFallbackReason.set(node.id, 'search_limit');
        }
      }
      if (omittedImageSearchGroups.length) {
        emit(425, [{ type: 'log', level: 'warn', from: 'designer', message: `图片搜索请求过多，已处理前 ${IMAGE_SEARCH_LIMIT} 个不同图位；其余图位将改用主题矢量插画。` }]);
      }
      if (imageSearchGroups.length) {
        onPhase?.(`按主题搜寻配图（${imageSearchGroups.length} 个不同图位）…`);
        const keys = getKeys();
        const imageSearchResults = await mapPool(imageSearchGroups, 2, async (group) => {
          // 人物/角色：先取 Wikipedia 角色条目正文里的官方形象图。
          // 实测这比搜索引擎准确得多 —— 搜 "Doctor Strange Marvel" 会拿到 cosplay，
          // 下游需要的是已下载的 { buf, ext }，所以这里必须下载；
          // 下载失败就换下一个候选，全失败则回退搜索（不让整次生成崩掉）。
          if (looksLikePersonQuery(group.query)) {
            for (const wikiTitle of wikipediaTitleCandidates(group.query)) {
              let portraits = [];
              try {
                portraits = await wikipediaCharacterPortraitCandidates(wikiTitle, 2);
              } catch {
                portraits = [];
              }
              for (const portrait of portraits) {
                try {
                  // 必须走 scraper 的 downloadImage：Wikimedia 直连会超时、
                  // 裸 fetch 经代理会被 403（UA 不合规）。该函数已处理代理与 UA。
                  const got = await downloadImage(portrait.url);
                  if (!got || got.buf.length < 10_000 || got.buf.length > 8_000_000) continue;
                  return {
                    group,
                    provider: 'Wikipedia 角色肖像',
                    candidates: [{ ...portrait, buf: got.buf, ext: got.ext }],
                  };
                } catch { /* 下载失败，试下一张 */ }
              }
            }
          }

          const queries = imageSearchQueryCascade(group.query);
          for (const query of queries) {
            const skippedProviders = new Set();
            for (let sourcePass = 0; sourcePass < 6; sourcePass++) {
              const result = await collectImages({ query, count: 12, keys, skipProviders: [...skippedProviders] });
              if (!result.images.length) break;
              const { ranked } = rankCandidates(result.images, { targets: imageSearchTargets(query) });
              const candidates = ranked.filter((item) => imageCandidateUsable(item, query))
                .sort((a, b) => {
                if (looksLikePersonQuery(group.query)) {
                  const dt = personaAssetTier(b.cand) - personaAssetTier(a.cand);
                  if (dt !== 0) return dt;
                }
                return imageCandidateRelevance(b.cand, group.query) - imageCandidateRelevance(a.cand, group.query);
              })
                .map((item) => item.cand);
              if (candidates.length) return { group, provider: result.provider, candidates };
              if (!result.provider || result.provider === 'none') break;
              skippedProviders.add(result.provider);
              if (skippedProviders.size >= 6) break;
            }
          }
          return { group, candidate: null };
        });

        const selectedPhotoSignatures = new Set();
        for (const outcome of imageSearchResults) {
          if (!outcome) continue;
          const { group } = outcome;
          const candidates = outcome.candidates ?? [];
          const candidate = candidates.find((item) => {
            const signature = String(item?.src ?? item?.url ?? item?.page ?? '').trim().toLowerCase();
            return !signature || !selectedPhotoSignatures.has(signature);
          }) ?? null;
          const signature = candidate && String(candidate.src ?? candidate.url ?? candidate.page ?? '').trim().toLowerCase();
          if (signature) selectedPhotoSignatures.add(signature);
          if (!candidate) {
            for (const node of group.nodes) {
              node.src = '';
              imageFallbackReason.set(node.id, 'no_suitable_result');
            }
            emit(425, [{ type: 'log', level: 'warn', from: 'designer', message: `图片搜索未找到足够相关且清晰的结果（${group.query.slice(0, 80)}）；将绘制对应主题的原创矢量插画。` }]);
            continue;
          }
          const sceneMismatch = hasUnsupportedSceneDetails(candidate, group.query);
          const verifiedTitle = sourceTitle(candidate);
          const file = `images/pp-search-${group.nodes[0].id}.${candidate.ext}`;
          pagePlanImageFiles.set(file, candidate.buf);
          for (const node of group.nodes) {
            node.src = file;
            if (sceneMismatch && verifiedTitle) {
              node.alt = `${verifiedTitle} 实拍照片`;
              node.caption = `${verifiedTitle}（实拍图）`;
            }
            pagePlanImageCredits.set(node.id, { author: candidate.author, license: candidate.license, page: candidate.page });
            pagePlanImageProvenance.push({
              nodeId: node.id,
              query: group.query,
              provider: outcome.provider,
              file,
              bytes: candidate.buf.length,
              title: candidate.title,
              author: candidate.author,
              license: candidate.license,
              page: candidate.page,
              src: candidate.page,
            });
          }
        }
      }

      if (!textOnlyRequest) {
        for (const node of plannedImageNodes) {
          const src = String(node.src ?? '').trim();
          if (src && !/^https:\/\//i.test(src) && !pagePlanImageFiles.has(src) && !fs.existsSync(path.join(ws, src))) {
            node.src = '';
            imageFallbackReason.set(node.id, 'source_asset_missing');
          }
        }
      }
      // 先下载模型提供的 HTTPS 图片；下载失败的图会在下一步替换为本地原创插画。
      const downloadedAssets = await bundlePagePlanAssets(planResult.plan, {
        existing: (rel) => pagePlanImageFiles.has(rel) || fs.existsSync(path.join(ws, rel)),
      });
      const unresolvedImageIds = new Set(downloadedAssets.unresolved.map((item) => item.nodeId));
      const imageNodes = plannedImageNodes;
      if (!textOnlyRequest) {
        for (const node of imageNodes) {
          const missingLocalAsset = unresolvedImageIds.has(node.id);
          if (missingLocalAsset) node.src = '';
          const currentSrc = String(node.src ?? '').trim();
          if (currentSrc && !/^https:\/\//i.test(currentSrc) && !pagePlanImageFiles.has(currentSrc) && !fs.existsSync(path.join(ws, currentSrc))) {
            node.src = '';
            imageFallbackReason.set(node.id, 'source_asset_missing');
          }
          if (String(node.src ?? '').trim()) continue;

          const query = String(node.searchQuery ?? node.alt ?? planResult.plan.meta.title).trim();
          const file = `images/pp-illustration-${node.id}.svg`;
          const buf = createTopicIllustration({ query, theme: planResult.plan.theme });
          pagePlanImageFiles.set(file, buf);
          node.src = file;
          pagePlanImageCredits.set(node.id, { author: 'OrchestrAI', license: '原创矢量插画', page: '' });
          const reason = missingLocalAsset ? 'source_download_failed' : (imageFallbackReason.get(node.id) ?? 'no_suitable_photo');
          pagePlanImageFallbacks.push({ nodeId: node.id, query, reason, file });
          pagePlanImageProvenance.push({
            nodeId: node.id,
            query,
            provider: 'OrchestrAI topic illustration',
            file,
            bytes: buf.length,
            title: `${query} · 主题矢量插画`,
            author: 'OrchestrAI',
            license: '原创矢量插画',
            page: '',
            src: file,
          });
        }
      }
      const fallbackNodeIds = new Set(pagePlanImageFallbacks.map((item) => item.nodeId));
      const assetBundle = {
        ...downloadedAssets,
        unresolved: downloadedAssets.unresolved.filter((item) => !fallbackNodeIds.has(item.nodeId)),
      };
      const finalVisualAssessment = assessPagePlanVisualComposition(planResult.plan, requirement, { includeSearchIntents: false });
      if (!finalVisualAssessment.ok) {
        throw new PagePlanGenerationError('PAGEPLAN_VISUAL_COMPOSITION_INSUFFICIENT', finalVisualAssessment.reason, finalVisualAssessment.metrics);
      }

      const rendered = renderPagePlan(planResult.plan, { imageCredits: pagePlanImageCredits });
      files = { ...rendered.files };
      for (const a of assetBundle.assets) files[a.file] = a.buf;
      for (const [file, buf] of pagePlanImageFiles) files[file] = buf;
      if (assetBundle.unresolved.length) {
        emit(425, [
          { type: 'log', level: 'warn', from: 'frontend', message: `⚠ ${assetBundle.unresolved.length} 张图片未能落地：${assetBundle.unresolved.map((u) => u.nodeId).join('、')}` },
        ]);
      }
      // PagePlan 产物是单页静态站点：为交付物生成真实可执行的一致性测试，
      // 断言"计划里的 section/主题/披露项确实落到了产物 HTML"，而不是重跑渲染器。
      const planSections = [];
      const collectPlanSections = (nodes) => {
        for (const n of nodes ?? []) {
          if (n.type === 'section' && n.title) planSections.push({ id: n.id, title: n.title });
          collectPlanSections(n.children);
        }
      };
      collectPlanSections(planResult.plan.nodes);
      const hasScene3d = rendered.report.features?.scene3d?.scenes > 0;

      // ---- Scene Brief 交叉校验 + 几何/构图检查（M7-B4C）----
      // 自动检查只覆盖可量化的硬伤；美术完成度必须人工看截图，不在此处假装通过。
      let sceneBrief = null;
      let sceneReview = null;
      if (hasScene3d) {
        onPhase?.('渲染检查：校对创作意图与场景几何…');
        const findSceneNode = (nodes) => {
          for (const n of nodes ?? []) {
            if (n.type === 'scene3d') return n;
            const inChildren = findSceneNode(n.children);
            if (inChildren) return inChildren;
            if (n.type === 'tabs') {
              for (const panel of n.panels ?? []) {
                const inPanel = findSceneNode(panel.children);
                if (inPanel) return inPanel;
              }
            }
          }
          return null;
        };
        const sceneNode = findSceneNode(planResult.plan.nodes);
        sceneBrief = planResult.plan.sceneBrief ?? null;

        // 缺 sceneBrief 是**合法的向后兼容情形**（旧计划本来就没有这个字段）：
        // 只作为 warning 记录"创作意图不可追溯"，绝不因此阻断交付。
        // 只有"brief 存在但与场景矛盾"才阻断——那是真的自相矛盾。
        const briefCheck = sceneBrief
          ? crossCheckBriefAgainstScene(sceneBrief, sceneNode)
          : { ok: true, findings: [{ code: 'NO_SCENE_BRIEF', severity: 'warning', detail: '模型未提供 sceneBrief：创作意图不可追溯，构图质量无法核对（不影响交付）' }] };
        const geometry = checkSceneGeometry(sceneNode, sceneBrief);
        const review = summariseSceneReview({ geometry, rendering: null });
        sceneReview = {
          brief: sceneBrief,
          briefCheck,
          geometry: geometry.metrics,
          findings: [...briefCheck.findings, ...review.findings],
          ok: briefCheck.ok && review.ok,
        };

        const briefBlocking = briefCheck.findings.filter((f) => f.severity === 'blocking');
        const layerText = sceneBrief ? [...new Set(sceneBrief.objects.map((o) => o.layer))].join('/') : '-';
        const briefMsg = sceneBrief
          ? '🎬 Scene Brief：' + sceneBrief.theme + '｜主体 ' + sceneBrief.subject.id + '｜层深 ' + layerText + '｜材质 ' + sceneBrief.materials.length + ' 种'
          : '⚠ 模型未提供 sceneBrief：创作意图不可追溯（几何检查仍会执行）';
        emit(415, [
          { type: 'log', level: briefBlocking.length ? 'warn' : (sceneBrief ? 'success' : 'warn'), from: 'designer', message: briefMsg },
          { type: 'gate_result', gate: 'scene_brief', passed: briefCheck.ok, detail: briefCheck.findings.length ? briefCheck.findings.map((f) => f.code + ': ' + f.detail).join(' · ').slice(0, 400) : 'brief 与场景一致' },
          { type: 'log', level: geometry.findings.some((f) => f.severity === 'blocking') ? 'warn' : 'info', from: 'supervisor', message: '📐 几何检查：' + geometry.metrics.objects + ' 对象 / 复合原语 ' + Math.round(geometry.metrics.compositeRatio * 100) + '% / 材质 ' + geometry.metrics.materials.length + ' 种 → ' + geometry.findings.length + ' 项发现（' + geometry.findings.filter((f) => f.severity === 'blocking').length + ' 阻断）' },
        ]);

        if (!briefCheck.ok) {
          const reason = 'Scene Brief 与场景不一致：' + briefBlocking.map((f) => f.detail).join('；').slice(0, 220);
          emit(416, [
            { type: 'log', level: 'error', from: 'supervisor', message: '⛔ ' + reason + '——终止交付，不回退模板' },
            { type: 'task_status_changed', taskId: 'T1', from: 'in_progress', to: 'blocked', reason },
          ]);
          persistProject(cues, {
            projectId, spec, sentence, files, ws, projectTitle,
            delivered: false, deliveryVersion: null, previewUrl: null,
            testSummary: reason, hadDefectFix: false, firstOk: false,
          });
          return { projectId, cues, previewUrl: null, workspace: ws, failed: true, blocked: 'scene_brief_mismatch', reason };
        }
      }
      // 页面里唯一允许的脚本 = 报告里声明的 runtime（可能含交互运行时）
      const renderedRuntime = (() => {
        const m = rendered.files['index.html'].match(/<script>([\s\S]*?)<\/script>/);
        return m ? m[1] : '';
      })();
      files['test/pageplan.test.mjs'] = buildWorkspaceTest({
        sectionIds: planSections.map((s) => s.id),
        title: planResult.plan.meta.title,
        themeVars: ['--pp-bg', '--pp-surface', '--pp-text', '--pp-muted', '--pp-accent', '--pp-accent-soft'],
        unsupported: planResult.plan.unsupportedRequests,
        scene3dRuntime: renderedRuntime,
      });
      pagePlanExpect = {
        sectionIds: planSections.map((s) => s.id),
        title: planResult.plan.meta.title,
        scene3dRuntime: renderedRuntime,
        imageRequired: !textOnlyRequest,
      };
      // 项目元数据与页面保持一致：标题与"功能集"都应来自模型计划，而不是模板默认值
      spec.title = projectTitle || planResult.plan.meta.title;
      spec.features = planSections.map((s) => s.title);
      spec.matchedBy = `PagePlan 结构化生成（${planResult.metadata.provider}/${planResult.metadata.model}）`;
      pagePlanReport = {
        ...rendered.report,
        meta: planResult.metadata,
        styleOrigin: spec.styleOrigin ?? null,
        sections: planSections,
        assets: {
          bundled: [...assetBundle.assets.map(({ buf, ...rest }) => rest), ...pagePlanImageProvenance],
          unresolved: assetBundle.unresolved,
          omitted: pagePlanImageOmissions,
          fallbacks: pagePlanImageFallbacks,
        },
        // M7-B4C：创作意图 + 交叉校验 + 几何检查必须随报告落盘，供事后审计
        sceneReview,
      };
      spec.pagePlanReport = pagePlanReport;
      spec.pagePlanUsed = true;
      spec.pagePlanMeta = planResult.metadata;
      emit(420, [
        { type: 'agent_run_started', runId: 'R-P1', taskId: 'T1', role: 'frontend', model: { provider: planResult.metadata.provider, modelId: planResult.metadata.model } },
        { type: 'agent_step', runId: 'R-P1', taskId: 'T1', role: 'frontend', step: { at: 0, kind: 'tool', tool: 'pageplan', detail: `节点数 ${rendered.report.nodeCount}，插图 ${rendered.report.features.images} 张，尝试 ${planResult.metadata.attempts} 次，${planResult.metadata.elapsedMs}ms${hasScene3d ? `，含真实 WebGL 场景（${rendered.report.features.scene3d.objects} 个对象）` : ''}` } },
        { type: 'agent_run_ended', runId: 'R-P1', taskId: 'T1', role: 'frontend', status: 'succeeded', usage: { inputTokens: null, outputTokens: null, costUsd: 0, usageStatus: planResult.metadata.usageStatus } },
        { type: 'log', level: 'success', from: 'frontend', message: `🧩 PagePlan 渲染完成：${rendered.report.nodeCount} 个节点 · 插图 ${rendered.report.features.images} 张 · 风格 ${planResult.plan.theme.styleId}（${spec.styleOrigin === 'user-locked' ? '用户锁定' : '自动'}）${hasScene3d ? ` · 3D 场景 ${rendered.report.features.scene3d.objects} 对象（WebGL1 本地渲染）` : ''}` },
        ...(Array.isArray(planResult.metadata.repairs) && planResult.metadata.repairs.length
          ? [{ type: 'log', level: 'info', from: 'frontend', message: `🔧 PagePlan 校验前做过 ${planResult.metadata.repairs.length} 处机械规范化（不涉及内容）：${planResult.metadata.repairs.slice(0, 6).map((r) => `${r.path} ${r.action}${r.keys ? `(${r.keys.join('/')})` : ''}`).join('；')}${planResult.metadata.repairs.length > 6 ? ` 等 ${planResult.metadata.repairs.length} 项` : ''}` }]
          : []),
      ]);
    } catch (e) {
      const code = e?.code ?? 'PAGEPLAN_UNKNOWN';
      const detail = String(e?.message ?? e).slice(0, 200);
      emit(430, [
        { type: 'log', level: 'error', from: 'supervisor', message: `⛔ PagePlan 失败（${code}）：${detail}——终止交付，不回退模板` },
        { type: 'gate_result', gate: 'pageplan', passed: false, detail: `${code}: ${detail}` },
        { type: 'task_status_changed', taskId: 'T1', from: 'in_progress', to: 'blocked', reason: `PagePlan ${code}` },
      ]);
      persistProject(cues, {
        projectId, spec, sentence, files: {}, ws, projectTitle,
        delivered: false, deliveryVersion: null, previewUrl: null,
        testSummary: `PagePlan 生成失败，未产出页面：${code} — ${detail}`,
        hadDefectFix: false, firstOk: false,
      });
      return {
        projectId, cues, previewUrl: null, workspace: ws, failed: true,
        blocked: 'pageplan_failed', reason: `PagePlan 失败（${code}）：${detail}`,
      };
    }
  } else {
    files = buildFiles(spec, { defect: spec.plantDefect });
  }
  // 采集到的图片真实文件并入产物清单
  for (const img of spec.images ?? []) files[img.file] = img.buf;
  const totalLines = Object.values(files).reduce(
    (a, c) => a + (Buffer.isBuffer(c) ? 0 : c.split('\n').length), 0);
  const isGallery = spec.type === 'gallery';

  // ---- 阶段 0/1：项目与需求 ----
  emit(300, [
    { type: 'project_created', projectId, projectName: projectTitle ? `${spec.title} · OrchestrAI 项目` : `${spec.title}（${spec.template.meta.name}）`, workspace: `workspaces/${projectId}` },
    { type: 'log', level: 'success', from: 'supervisor', message: `阶段 0 完成：真实工作区已建立 ${ws}` },
  ]);
  emit(400, [
    { type: 'phase_changed', phase: '阶段 1 · 需求接单与澄清（真实模式）', status: 'clarifying' },
    { type: 'requirement_submitted', userText: sentence.length > 300 ? sentence.slice(0, 300) + `…（共 ${sentence.length} 字符）` : sentence, version: 'v0.1' },
    { type: 'agent_state_changed', role: 'supervisor', status: 'analyzing', detail: '解析一句话需求 → 应用类型 / 标题 / 功能' },
  ]);
  emit(700, [
    {
      type: 'requirement_drafted',
      requirement: {
        id: 'RV-1', version: 'v0.1', userText: sentence.length > 1000 ? sentence.slice(0, 1000) + `…（共 ${sentence.length} 字符）` : sentence,
        overview: usePagePlan
          ? `OrchestrAI 生成应用：需求 ${sentence.length} 字符 → 由模型产出 PagePlan（${spec.matchedBy}）。页面结构由节点树决定：${(pagePlanReport?.sections ?? []).length} 个章节 / ${pagePlanReport?.nodeCount ?? 0} 个节点。`
          : `OrchestrAI 生成应用：需求 ${sentence.length} 字符 → 识别为「${spec.template.meta.name}」（${spec.matchedBy}）。${isGallery ? `素材主题「${spec.galleryQuery}」，图源：${spec.provider}（${(spec.images ?? []).length} 张）。` : ''}`,
        userStories: [{
          id: 'US1',
          story: `作为用户，我可以使用${spec.title}${usePagePlan ? '浏览页面全部章节内容' : `完成${spec.template.meta.name}的核心操作`}`,
          acceptance: spec.features,
        }],
        assumptions: ['单用户本地使用，无账号体系', '生成的应用为免构建静态 Web App（可直接预览）', `功能集：${spec.features.join('；')}`],
        risks: spec.plantDefect ? ['需求包含“预设缺陷”：首次测试将真实失败，用于验证门禁拦截'] : (usePagePlan ? ['PagePlan 渲染器当前仅覆盖内置 14 类节点，3D/自定义交互需扩展渲染器'] : ['模板化生成，复杂个性化需求需后续接入大模型']),
        status: 'draft', createdAt: 0,
      },
    },
    { type: 'log', level: 'info', from: 'supervisor', message: `${usePagePlan ? '页面规划' : '意图识别'}：${spec.matchedBy}${!usePagePlan && spec.viaLLM === false && spec.llmFallbackReason ? `（LLM 调用失败已回退规则：${spec.llmFallbackReason}）` : ''}；标题「${spec.title}」；视觉风格「${styleDef.name}」；动效「${({ off: '关闭', subtle: '柔和', full: '炫动（粒子避让+拖尾+涟漪）' })[spec.resolvedFx ?? 'subtle']}」${spec.plantDefect ? '；⚠ 检测到预设缺陷指令' : ''}` },
  ]);

  // ---- 阶段 2：计划 ----
  const plan = [
    { id: 'T1', title: isGallery ? `生成「${spec.title}」应用与网络素材` : `生成「${spec.title}」应用文件`, kind: 'frontend', role: 'frontend', dependsOn: [], inputs: ['需求 v0.1'], outputs: Object.keys(files).filter((f) => !f.startsWith('test/') && f !== 'package.json') },
    { id: 'T2', title: '运行真实测试（node --test）', kind: 'test', role: 'tester', dependsOn: ['T1'], inputs: ['test/logic.test.mjs'], outputs: ['真实测试报告（退出码 + 日志）'] },
    { id: 'T3', title: '打包交付与预览', kind: 'docs', role: 'docs', dependsOn: ['T2'], inputs: ['全部产物'], outputs: ['交付清单 + 可预览地址'] },
  ];
  emit(400, [
    { type: 'phase_changed', phase: '阶段 2 · 方案与任务拆分', status: 'planning' },
    { type: 'agent_state_changed', role: 'supervisor', status: 'idle' },
    { type: 'plan_created', tasks: plan, note: `真实生成 3 项任务：写文件 → 真测试 → 交付预览（约 ${totalLines} 行代码/资源）` },
  ]);

  // ---- 阶段 3：真实写文件（T1） ----
  emit(350, [
    { type: 'phase_changed', phase: '阶段 3 · 设计与实现（真实写盘）', status: 'developing' },
    { type: 'task_status_changed', taskId: 'T1', from: 'pending', to: 'in_progress' },
    { type: 'agent_state_changed', role: 'frontend', status: 'working', taskId: 'T1', detail: `实例化「${spec.template.meta.name}」模板并写入工作区` },
    { type: 'agent_run_started', runId: 'R-01', taskId: 'T1', role: 'frontend', model: MODEL },
  ]);
  let seq = 0;
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(ws, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    const isBinary = Buffer.isBuffer(content);
    const bytes = isBinary ? content.length : Buffer.byteLength(content);
    const lines = isBinary ? 0 : content.split('\n').length;
    const kind = isBinary ? 'design' : rel.endsWith('.html') || rel.endsWith('.css') ? 'design' : rel.includes('test') ? 'test' : 'code';
    emit(240, [
      { type: 'agent_step', runId: 'R-01', taskId: 'T1', role: 'frontend', step: { at: 0, kind: 'tool', tool: 'write_file', detail: `写入 ${rel}（${isBinary ? `${bytes} 字节二进制` : `${lines} 行`}, ${bytes} B）` } },
      {
        type: 'artifact_created',
        artifact: { id: `A-${String(++seq).padStart(2, '0')}`, taskId: 'T1', kind, path: `workspaces/${projectId}/${rel}`, summary: `${spec.title} · ${rel}`, linesAdded: lines || undefined, linesRemoved: 0 },
      },
    ]);
  }
  emit(300, [
    { type: 'agent_run_ended', runId: 'R-01', taskId: 'T1', status: 'succeeded', usage: usage(1800 + totalLines * 12, totalLines * 4, 0.02) },
    { type: 'agent_state_changed', role: 'frontend', status: 'awaiting_review', taskId: 'T1' },
    { type: 'task_status_changed', taskId: 'T1', from: 'in_progress', to: 'awaiting_review' },
    { type: 'log', level: 'info', from: 'supervisor', message: `复核 T1：${Object.keys(files).length} 个文件已真实写入磁盘，产物清单见任务面板` },
    { type: 'task_status_changed', taskId: 'T1', from: 'awaiting_review', to: 'done' },
    { type: 'agent_state_changed', role: 'frontend', status: 'idle' },
  ]);

  // ---- 阶段 5：静态质量门禁（T2 前置）+ 真实测试（T2）----
  onPhase?.('写入真实文件到工作区…');
  // 静态质量门禁（已写盘后检查）
  // PagePlan 产物契约是"单页静态站点"（无 PWA 清单/SW/图标），必须用对应的门禁，
  // 否则会把合法产物误判为缺文件。两条路径都是真实文件系统检查。
  const problems = usePagePlan
    ? staticCheckPagePlan(ws, pagePlanExpect ?? {})
    : staticCheck(ws);
  emit(260, [
    { type: 'phase_changed', phase: '阶段 5 · 静态质量门禁 + 独立测试', status: 'integrating' },
    { type: 'agent_state_changed', role: 'tester', status: 'analyzing', taskId: 'T2', detail: usePagePlan ? 'PagePlan 产物检查：结构 / 安全 / 锚点 / 主题一致性' : '资源完整性检查：PWA 清单 / 图标 / SW / 测试文件' },
    {
      type: 'gate_result',
      gate: 'static',
      passed: problems.length === 0,
      detail: problems.length === 0
        ? (usePagePlan
          ? `静态门禁通过：HTML 结构完整、无脚本/内联处理器、锚点可达、主题变量合法、${(pagePlanExpect?.sectionIds ?? []).length} 个计划 section 均已渲染${pagePlanExpect?.imageRequired ? '、至少一张本地图片存在且已落地' : ''}`
          : '静态门禁通过：manifest/SW/双尺寸图标/测试文件齐全，PNG 尺寸校验正确，index.html 含安装标记')
        : `静态门禁未通过：${problems.join('；')}`,
      taskId: 'T2',
    },
  ]);
  if (problems.length > 0) {
    emit(200, [
      { type: 'log', level: 'error', from: 'supervisor', message: `静态质量门禁失败，禁止交付：${problems.join('；')}` },
      { type: 'task_status_changed', taskId: 'T1', from: 'done', to: 'blocked', reason: '静态质量门禁未通过' },
    ]);
    persistProject(cues, {
      projectId, spec, sentence, files, ws, projectTitle,
      delivered: false, deliveryVersion: null, previewUrl: null,
      testSummary: '静态质量门禁未通过', hadDefectFix: false, firstOk: false,
    });
    return { projectId, cues, previewUrl: null, workspace: ws, failed: true };
  }

  const doTest = async (runId, trIdNo, supersedes) => {
    emit(300, [
      { type: 'task_status_changed', taskId: 'T2', from: 'pending', to: 'in_progress', attempt: supersedes ? 2 : 1 },
      { type: 'agent_state_changed', role: 'tester', status: 'testing', taskId: 'T2', detail: '真实执行 node --test（子进程）' },
      { type: 'agent_run_started', runId, taskId: 'T2', role: 'tester', model: TESTER_MODEL },
      { type: 'agent_step', runId, taskId: 'T2', role: 'tester', step: { at: 0, kind: 'tool', tool: 'run_command', detail: '$ node --test' } },
    ]);
    onPhase?.('真实执行 node --test …');
    const r = await runNodeTests(ws);
    const ok = r.exitCode === 0;
    emit(Math.min(1500, Math.max(500, r.durationMs)), [
      {
        type: 'test_run_recorded',
        testRun: {
          id: trId(trIdNo), taskId: 'T2', kind: 'unit', command: 'node --test',
          startedAt: 0, endedAt: 0, exitCode: r.exitCode, passed: r.passed, failed: r.failed,
          summary: `${ok ? '真实测试全部通过' : '真实测试失败'}（耗时 ${r.durationMs}ms${supersedes ? '，修复后重跑' : ''}）`,
          logExcerpt: r.logExcerpt, logPath: r.logRelPath, supersedes,
        },
      },
      { type: 'gate_result', gate: 'unit', passed: ok, detail: `真实运行器退出码 ${r.exitCode}（${r.passed}✓/${r.failed}✗），日志 ${r.logRelPath}`, testRunId: trId(trIdNo), taskId: 'T2' },
    ]);
    emit(280, [
      { type: 'agent_run_ended', runId, taskId: 'T2', status: ok ? 'succeeded' : 'failed', usage: usage(600, 200, 0.01) },
    ]);
    return ok;
  };

  const firstOk = await doTest('R-02', 1, undefined);

  if (!firstOk && usePagePlan) {
    // PagePlan 产物没有模板 logic.mjs 可"修复"：测试失败说明计划与产物不一致，
    // 只能阻断交付并如实报告，不能用模板代码去糊弄测试。
    emit(200, [
      { type: 'log', level: 'error', from: 'supervisor', message: '⛔ PagePlan 产物测试失败：计划与落盘产物不一致，终止交付（不回退模板）' },
      { type: 'task_status_changed', taskId: 'T2', from: 'in_progress', to: 'blocked', reason: 'PagePlan 产物一致性测试失败' },
    ]);
    persistProject(cues, {
      projectId, spec, sentence, files, ws, projectTitle,
      delivered: false, deliveryVersion: null, previewUrl: null,
      testSummary: 'PagePlan 产物一致性测试失败，未交付', hadDefectFix: false, firstOk,
    });
    return { projectId, cues, previewUrl: null, workspace: ws, failed: true, blocked: 'pageplan_test_failed', reason: 'PagePlan 产物一致性测试失败' };
  }

  if (!firstOk) {
    // ---- 真实缺陷 → 门禁拦截 → 退回 T1 → 修复重跑 ----
    emit(350, [
      { type: 'agent_state_changed', role: 'tester', status: 'failed', taskId: 'T2', reason: `TR-01 退出码非 0：${spec.template.meta.name} 逻辑存在缺陷（见真实日志）` },
      { type: 'log', level: 'error', from: 'supervisor', message: '测试门禁未通过（真实失败）—— 退回 T1 修复，禁止交付' },
      { type: 'task_status_changed', taskId: 'T1', from: 'done', to: 'rework', reason: '真实测试失败：logic.mjs 存在缺陷（预设缺陷演示）' },
      { type: 'task_status_changed', taskId: 'T2', from: 'in_progress', to: 'pending' },
      { type: 'agent_state_changed', role: 'frontend', status: 'working', taskId: 'T1', detail: '按测试报告定位并修复 logic.mjs' },
      { type: 'task_status_changed', taskId: 'T1', from: 'rework', to: 'in_progress', attempt: 2 },
      { type: 'agent_run_started', runId: 'R-03', taskId: 'T1', role: 'frontend', model: MODEL },
    ]);
    const fixed = spec.template.fixedLogic(spec.template.files(spec));
    fs.writeFileSync(path.join(ws, 'logic.mjs'), fixed);
    emit(400, [
      { type: 'agent_step', runId: 'R-03', taskId: 'T1', role: 'frontend', step: { at: 0, kind: 'tool', tool: 'write_file', detail: '重写 logic.mjs（移除缺陷标记，恢复正确实现）' } },
      {
        type: 'artifact_created',
        artifact: { id: `A-${String(++seq).padStart(2, '0')}`, taskId: 'T1', kind: 'code', path: `workspaces/${projectId}/logic.mjs`, summary: '修复版 logic.mjs（缺陷移除）', linesAdded: fixed.split('\n').length, linesRemoved: files['logic.mjs'].split('\n').length },
      },
      { type: 'agent_run_ended', runId: 'R-03', taskId: 'T1', status: 'succeeded', usage: usage(900, 300, 0.01) },
      { type: 'task_status_changed', taskId: 'T1', from: 'in_progress', to: 'awaiting_review' },
      { type: 'log', level: 'info', from: 'supervisor', message: '复核修复：变更仅覆盖缺陷点 —— 按影响范围重跑全部测试' },
      { type: 'task_status_changed', taskId: 'T1', from: 'awaiting_review', to: 'done' },
      { type: 'agent_state_changed', role: 'frontend', status: 'idle' },
    ]);
    const secondOk = await doTest('R-04', 2, 'TR-01');
    if (!secondOk) {
      emit(200, [
        { type: 'log', level: 'error', from: 'supervisor', message: '修复后仍失败：进入人工介入状态（演示模板不应出现此情况）' },
        { type: 'task_status_changed', taskId: 'T2', from: 'in_progress', to: 'blocked', reason: '两次真实测试失败' },
      ]);
      persistProject(cues, {
        projectId, spec, sentence, files, ws, projectTitle,
        delivered: false, deliveryVersion: null, previewUrl: null,
        testSummary: '两次真实测试均失败，已阻塞等待人工介入', hadDefectFix: true, firstOk,
      });
      return { projectId, cues, previewUrl: null, workspace: ws, failed: true };
    }
  }

  emit(280, [
    { type: 'agent_state_changed', role: 'tester', status: 'awaiting_review', taskId: 'T2' },
    { type: 'task_status_changed', taskId: 'T2', from: 'in_progress', to: 'awaiting_review' },
    { type: 'log', level: 'info', from: 'supervisor', message: '复核 T2：结论来自真实子进程（退出码 + 落盘日志），通过' },
    { type: 'task_status_changed', taskId: 'T2', from: 'awaiting_review', to: 'done' },
    { type: 'agent_state_changed', role: 'tester', status: 'idle' },
  ]);

  // ---- 主管视觉审查（T2.5）：逐个检查所有按键/输入框的事件绑定、素材完整性与形态互斥 ----
  onPhase?.('主管视觉审查：检查所有按键与素材…');
  const audit = visualAudit(files);
  emit(290, [
    { type: 'agent_state_changed', role: 'supervisor', status: 'reviewing', detail: `视觉审查 ${audit.buttons.length} 个交互元素 / 素材清单 / 形态互斥` },
    { type: 'log', level: audit.ok ? 'success' : 'warn', from: 'supervisor', message: (audit.ok ? '🔍 ' : '🔍⚠ ') + audit.summary },
    ...(!audit.ok ? [{ type: 'gate_result', gate: 'visual_audit', passed: false, detail: audit.summary }] : []),
    ...(audit.ok ? [{ type: 'gate_result', gate: 'visual_audit', passed: true, detail: `全部 ${audit.buttons.length} 个按键绑定事件 · 素材 ${audit.missingImages.length} 缺失 · 形态守卫就位` }] : []),
    { type: 'agent_state_changed', role: 'supervisor', status: 'idle' },
  ]);

  // ---- 需求覆盖审计（M7-B4A 静态可达性 → M7-B4B 质量轮升级为可信门禁）----
  // 两层判定：
  //   1) 静态可达性（reqcoverage.mjs）：关键字+结构初筛，仅用于发现"需求写了但页面完全没有痕迹"；
  //   2) 可信覆盖状态（coverage-status.mjs）：只有 required 需求 + 真实证据（browser/integration/manual）
  //      才算 implemented_verified；required 缺证据或被模型降级为 unsupported → 阻断交付。
  // 静态匹配不能单独宣称语义等价，所以它不再拥有放行权。
  const requirementAcceptance = (() => {
    const built = cues.flatMap((c) => c.events).find((e) => e.type === 'requirement_drafted')?.requirement;
    return built?.userStories?.flatMap((u) => u.acceptance ?? []) ?? [];
  })();
  const coverage = auditRequirementCoverage(requirement, files, requirementAcceptance);
  spec.coverage = coverage;
  // 命名澄清（M7-B4C）：这一栏是基于关键字的**静态启发式提示**，没有阻断权。
  // 有阻断权的是后面的 required_coverage（基于可信证据）。两者同名会造成误读，
  // 因此这里改名为 requirement_hints，语义与阻断逻辑完全不变。
  emit(292, [
    { type: 'log', level: coverage.uncovered.length ? 'warn' : 'info', from: 'supervisor', message: `📋 ${coverage.summary}` },
    {
      type: 'gate_result', gate: 'requirement_hints',
      advisory: true,
      blocking: false,
      passed: coverage.uncovered.length === 0,
      detail: coverage.items.map((i) => `${i.label}:${i.status}(${i.reached}/${i.required})`).join(' · ') || '无能力项声明',
    },
  ]);
  const coverageWarning = coverage.uncovered.length
    ? `需求覆盖缺口：${coverage.uncovered.map((i) => `${i.label}（证据 ${i.reached}/${i.required}）`).join('、')}`
    : '';


  // ---- W2【交付可靠性】必需的素材缺失 → 阻断交付（不能把缺图的页面当完整交付）----
  // 说明：死按钮启发式仍为告警不阻断（避免误伤）；此处仅拦「清单引用但产物不存在」的硬缺失。
  if (audit.missingImages.length > 0) {
    const reason = `视觉审查阻断：${audit.missingImages.length} 个必需素材缺失（${audit.missingImages.slice(0, 3).join('、')}）`;
    emit(292, [
      { type: 'log', level: 'error', from: 'supervisor', message: `⛔ ${reason}——终止交付，不回退规则` },
      { type: 'task_status_changed', taskId: 'T3', from: 'pending', to: 'blocked', reason },
    ]);
    persistProject(cues, {
      projectId, spec, sentence, files, ws, projectTitle,
      delivered: false, deliveryVersion: null, previewUrl: null,
      testSummary: reason, hadDefectFix: !firstOk, firstOk,
    });
    return { projectId, cues, previewUrl: null, workspace: ws, failed: true };
  }

  // ---- 渲染门禁（Gate 4/6 证据）：Edge headless 双视口截图 + DOM 探针（必需图片/横向溢出）----
  // 开关 ORCHESTRAI_RENDERCHECK=off；环境缺失 → not_run 如实披露（不假绿）；fail → 阻断交付（W1）。
  let renderGate = null;
  if (process.env.ORCHESTRAI_RENDERCHECK !== 'off') {
    onPhase?.('渲染门禁：桌面/移动双视口截图与探针检查…');
    let commit = '';
    try { commit = (await import('node:child_process')).execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch { commit = 'unknown'; }
    try {
      renderGate = await renderCheck({ wsDir: ws, label: projectId, outDir: path.join(ws, '_rendercheck'), commit, requirement: sentence });
      emit(295, [
        { type: 'gate_result', gate: 'render', passed: renderGate.gate.pass, detail: renderGate.gate.reason },
        { type: 'log', level: renderGate.gate.status === 'pass' ? 'success' : renderGate.gate.status === 'not_run' ? 'warn' : 'error', from: 'supervisor', message: `🖥 渲染门禁[${renderGate.gate.status}]：${renderGate.gate.reason}（截图与指标见 _rendercheck/）` },
      ]);
    } catch (e) {
      renderGate = { gate: { pass: false, status: 'not_run', reason: String(e?.message ?? e).slice(0, 120) } };
      emit(295, [{ type: 'log', level: 'warn', from: 'supervisor', message: `🖥 渲染门禁未执行：${renderGate.gate.reason}` }]);
    }
  }

  // ---- W1【交付可靠性】渲染门禁 fail → 阻断交付（截图失败/必需图未加载/横向溢出/视口失真）----
  if (renderGate?.gate.status === 'fail') {
    const reason = `渲染门禁阻断：${renderGate.gate.reason}`;
    emit(296, [
      { type: 'log', level: 'error', from: 'supervisor', message: `⛔ ${reason}——终止交付，不回退规则` },
      { type: 'task_status_changed', taskId: 'T3', from: 'pending', to: 'blocked', reason },
    ]);
    persistProject(cues, {
      projectId, spec, sentence, files, ws, projectTitle,
      delivered: false, deliveryVersion: null, previewUrl: null,
      testSummary: reason, hadDefectFix: !firstOk, firstOk,
    });
    return { projectId, cues, previewUrl: null, workspace: ws, failed: true };
  }

  // ---- P0 硬闸：离线交付的素材必须全部打包（不依赖 ORCHESTRAI_RENDERCHECK）----
  // 为什么必须在 pipeline 里拦：渲染门禁可以关（离线环境/无浏览器），
  // 但"ZIP 里缺资源"是客观事实，与能不能开浏览器无关。之前靠 rendercheck 兜底，
  // 开关一关就会静默交付缺图页面（GAP-AUDIT-v2 §4）。
  if (usePagePlan) {
    try {
      const inventory = (pagePlanReport?.assets?.bundled ?? []).map((a) => ({
        id: a.nodeId, src: a.src, path: a.file, resolved: true, required: true,
      }));
      const unresolved = (pagePlanReport?.assets?.unresolved ?? []).map((u) => ({
        id: u.nodeId, src: u.src, reason: u.reason, required: true,
      }));
      const check = assertAssetsResolved({ assets: inventory, unresolved, bundleFiles: files, offlineDelivery: true });
      emit(426, [{ type: 'gate_result', gate: 'asset_resolution', passed: true, detail: '素材门禁通过：' + check.assetCount + ' 个引用全部打包进交付物' }]);
    } catch (e) {
      const code = e?.code ?? 'PAGEPLAN_ASSET_UNRESOLVED';
      const detail = String(e?.message ?? e).slice(0, 200);
      emit(427, [
        { type: 'log', level: 'error', from: 'supervisor', message: '⛔ 素材未全部解析（' + code + '）：' + detail + '——离线交付必须完整，终止' },
        { type: 'gate_result', gate: 'asset_resolution', passed: false, detail: code + ': ' + detail },
        { type: 'task_status_changed', taskId: 'T3', from: 'pending', to: 'blocked', reason: '素材未全部解析' },
      ]);
      persistProject(cues, {
        projectId, spec, sentence, files, ws, projectTitle,
        delivered: false, deliveryVersion: null, previewUrl: null,
        testSummary: '素材门禁阻断：' + detail, hadDefectFix: false, firstOk: false,
      });
      return { projectId, cues, previewUrl: null, workspace: ws, failed: true, blocked: 'asset_unresolved', reason: detail };
    }
  }

  // ---- P0 硬闸：required 需求不得与 delivered=true 并存 ----
  // 触发条件（任一）：required 需求缺真实证据 / 被模型标为 unsupported / 与已实现状态冲突。
  // 只有可信调用方标记 required 的需求才有阻断权；非必需项仍只披露（避免误伤探索性需求）。
  const requiredRequirements = Array.isArray(requiredRequirementIds) && requiredRequirementIds.length
    ? requiredRequirementIds.map((id) => ({ id, required: true }))
    : [];
  let coverageStatus = null;
  if (usePagePlan && requiredRequirements.length) {
    const evidence = [];
    // PagePlan 产物：3D 场景有真实 Edge 验收才算 browser 证据；渲染门禁 pass 算 integration 证据
    const sceneReport = pagePlanReport?.features?.scene3d;
    if (sceneReport?.scenes > 0) {
      evidence.push({ requirementId: 'REQ-3D', kind: 'browser', passed: Boolean(sceneReport.verifiedInBrowser), artifact: sceneReport.verifiedInBrowser ? 'docs/m7-b4bq-evidence' : '' });
    }
    if (renderGate?.gate?.status === 'pass') {
      evidence.push({ requirementId: 'REQ-3D', kind: 'integration', passed: true, artifact: `workspaces/${projectId}/_rendercheck` });
    }
    try {
      coverageStatus = evaluateRequirementCoverage({
        requirements: requiredRequirements,
        evidence: evidence.filter((e) => e.passed && e.artifact),
        unsupportedRequests: pagePlanReport?.unsupportedRequests ?? [],
      });
    } catch (e) {
      emit(292, [{ type: 'log', level: 'warn', from: 'supervisor', message: `覆盖状态判定失败：${String(e?.message ?? e).slice(0, 120)}` }]);
    }
    if (coverageStatus) {
      spec.coverageStatus = coverageStatus;
      emit(292, [{
        type: 'gate_result', gate: 'required_coverage', passed: !coverageStatus.blocking,
        detail: coverageStatus.requirements.map((r) => `${r.requirementId}:${r.status}`).join(' · '),
      }]);
      if (coverageStatus.blocking) {
        const blockedIds = coverageStatus.requirements.filter((r) => r.blocking).map((r) => `${r.requirementId}(${r.status})`);
        const reason = `必需需求未满足，禁止交付：${blockedIds.join('、')}`;
        emit(295, [
          { type: 'log', level: 'error', from: 'supervisor', message: `⛔ ${reason}` },
          { type: 'task_status_changed', taskId: 'T3', from: 'pending', to: 'blocked', reason },
        ]);
        persistProject(cues, {
          projectId, spec, sentence, files, ws, projectTitle,
          delivered: false, deliveryVersion: null, previewUrl: null,
          testSummary: reason, hadDefectFix: !firstOk, firstOk,
        });
        return { projectId, cues, previewUrl: null, workspace: ws, failed: true, blocked: 'required_coverage_blocked', reason };
      }
    }
  }

  // ---- 交付（T3）----
  const manifest = Object.keys(files).map((f) => `workspaces/${projectId}/${f}`);
  const previewUrl = `/preview/${projectId}/`;
  emit(300, [
    { type: 'phase_changed', phase: '阶段 6/7 · 主管验收与交付', status: 'integrating' },
    { type: 'task_status_changed', taskId: 'T3', from: 'pending', to: 'in_progress' },
    { type: 'agent_state_changed', role: 'docs', status: 'working', taskId: 'T3', detail: '生成交付清单与预览入口' },
    { type: 'agent_run_started', runId: 'R-05', taskId: 'T3', role: 'docs', model: MODEL },
    { type: 'agent_step', runId: 'R-05', taskId: 'T3', role: 'docs', step: { at: 0, kind: 'tool', tool: 'write_file', detail: `生成交付清单（${manifest.length} 个文件）` } },
    {
      type: 'artifact_created',
      artifact: { id: `A-${String(++seq).padStart(2, '0')}`, taskId: 'T3', kind: 'doc', path: `workspaces/${projectId}/index.html`, summary: `入口页（可预览：${previewUrl}）` },
    },
    { type: 'agent_run_ended', runId: 'R-05', taskId: 'T3', status: 'succeeded', usage: usage(500, 200, 0.01) },
    { type: 'task_status_changed', taskId: 'T3', from: 'in_progress', to: 'awaiting_review' },
    { type: 'gate_result', gate: 'acceptance', passed: true, detail: `验收通过：${Object.keys(files).length} 个真实文件 + 真实测试证据（${firstOk ? 'TR-01' : 'TR-02 修复后回归'}）` },
    { type: 'task_status_changed', taskId: 'T3', from: 'awaiting_review', to: 'done' },
    { type: 'agent_state_changed', role: 'docs', status: 'idle' },
  ]);
  emit(400, [
    {
      type: 'delivery_packaged',
      delivery: {
        version: '1.0.0',
        manifest: [...manifest, `在线预览：${previewUrl}`],
        knownLimits: [
          ...(usePagePlan
            ? [
              `页面结构由模型产出的 PagePlan 节点树决定（${pagePlanReport?.nodeCount ?? 0} 个节点，schema ${pagePlanReport?.schemaVersion ?? 'orchestrai.pageplan.v1'}）`,
              ...(pagePlanReport?.features?.scene3d?.scenes
                ? [`3D 场景：${pagePlanReport.features.scene3d.objects} 个对象的真实 WebGL1 网格渲染（本地无依赖运行时，非静态图）；材质为风格化高光，不是物理精确折射，也不支持外部 3D 模型导入`]
                : []),
              ...(pagePlanReport?.unsupportedRequests ?? [])
                .filter((u) => u.severity === 'nonblocking')
                .map((u) => `未实现：${u.capability} —— ${u.reason}`),
            ]
            : ['基于模板生成（P4 接入大模型后支持任意需求）']),
          ...(usePagePlan
            ? (pagePlanReport?.assets?.unresolved?.length
              ? [`⚠ ${pagePlanReport.assets.unresolved.length} 张图片未能落地，页面仍引用外链：${pagePlanReport.assets.unresolved.map((u) => u.nodeId).join('、')}（离线打开将缺图）`]
              : (pagePlanReport?.assets?.bundled?.length
                ? [`配图已打包进交付物（${pagePlanReport.assets.bundled.length} 张），离线可正常显示`]
                : []))
            : (spec.plantDefect ? ['包含一次真实缺陷修复记录（预设缺陷演示）'] : ['功能范围为模板默认集', '数据保存在浏览器本地'])),
          ...(usePagePlan && pagePlanReport?.assets?.fallbacks?.length
            ? [`${pagePlanReport.assets.fallbacks.length} 个未获合适网络素材的图位使用了本地绘制的主题矢量插画`]
            : []),
          ...(usePagePlan && pagePlanReport?.assets?.omitted?.length
            ? [`⚠ ${pagePlanReport.assets.omitted.length} 个可选图片图位未找到合适结果或超出搜索范围，已从页面省略：${pagePlanReport.assets.omitted.flatMap((o) => o.nodeIds ?? []).join('、')}`]
            : []),
          ...(!usePagePlan && spec.imageSource === 'placeholder'
            ? ['⚠ 网络图源不可达：当前使用本地生成示意卡；在可联网环境重新生成、或配置 Pexels/Unsplash Key 可获得真实照片']
            : !usePagePlan && spec.imageSource === 'network'
              ? [`图片来自 ${spec.provider}，署名与来源页在灯箱内展示；商用前请自行核对各图许可证`]
              : []),
        ],
        testSummary: usePagePlan
          ? `PagePlan 产物一致性测试 node --test：${firstOk ? '首次全绿' : '存在失败'}（见测试面板真实日志）`
          : `真实测试 node --test：${firstOk ? '首次全绿' : '首次失败 → 修复 → 回归通过'}（见测试面板真实日志）`,
        packagedAt: Date.now(),
      },
    },
    { type: 'phase_changed', phase: '已交付 1.0.0 · 可预览', status: 'delivered' },
    { type: 'log', level: 'success', from: 'supervisor', message: `「${spec.title}」已真实交付！点击「预览」标签页立即使用你的 App 🎉` },
  ]);

  if (coverageWarning) {
    emit(296, [{ type: 'log', level: 'warn', from: 'supervisor', message: `⚠ ${coverageWarning}（已交付，但功能完成度需人工复核）` }]);
  }
  persistProject(cues, {
    projectId, spec, sentence, files, ws, projectTitle,
    // 交付态必须写入，否则主页列表/恢复时读不到（此前漏传导致 project.json 缺这三个字段）
    delivered: true, deliveryVersion: '1.0.0', previewUrl,
    testSummary: `真实测试 node --test：${firstOk ? '首次全绿' : '首次失败 → 修复 → 回归通过'}；视觉审查：${audit.ok ? `${audit.buttons.length} 个按键全部绑定` : audit.summary}${renderGate ? `；渲染门禁[${renderGate.gate.status}]：${renderGate.gate.reason.slice(0, 60)}` : '；渲染门禁：未执行（开关关闭）'}`,
    hadDefectFix: !firstOk, firstOk,
  });

  return { projectId, cues, previewUrl, workspace: ws, failed: false };
}

/** 项目元数据 + 事件时间线持久化（主页列表与状态恢复的数据源） */
function persistProject(cues, o) {
  const { projectTitle } = o;
  const nameSuffix = o.projectTitle ? '' : `（${o.spec.pagePlanUsed ? 'PagePlan 结构化页面' : o.spec.template.meta.name}）`;
  const meta = {
    id: o.projectId,
    name: `${o.spec.title}${nameSuffix}`,
    sentence: o.sentence,
    // PagePlan 模式下 type/typeName 必须反映真实产物来源，否则列表与详情会继续显示旧模板名
    type: o.spec.pagePlanUsed ? 'pageplan' : o.spec.type,
    typeName: o.spec.pagePlanUsed ? 'PagePlan 结构化页面' : o.spec.template.meta.name,
    styleId: o.spec.styleDef?.id ?? null,
    styleName: o.spec.styleDef?.name ?? null,
    // 风格来源审计：user-locked = 用户开工前指定（不可覆盖）；auto-detected / default 为推断
    styleOrigin: o.spec.styleOrigin ?? null,
    userChoices: o.spec.styleLocked || o.spec.fontLocked || o.spec.directionLocked
      ? { style: o.spec.styleLocked ? o.spec.styleId : null, font: o.spec.fontLocked ? o.spec.fontMood : null, direction: o.spec.directionLocked ? o.spec.pageDirection : null }
      : null,
    fxLevel: o.spec.resolvedFx ?? 'subtle',
    viaLLM: o.spec.viaLLM ?? false,
    llmProvider: o.spec.llmProvider ?? null,
    // PagePlan 元信息：便于前端与审计区分"模型决定的结构"与"模板填充"
    pagePlan: o.spec.pagePlanUsed
      ? {
        schemaVersion: o.spec.pagePlanReport?.schemaVersion ?? null,
        nodeCount: o.spec.pagePlanReport?.nodeCount ?? null,
        sections: (o.spec.pagePlanReport?.sections ?? []).map((s) => s.title),
        unsupported: (o.spec.pagePlanReport?.unsupportedRequests ?? []).map((u) => ({ capability: u.capability, severity: u.severity })),
        // 3D 是"单元测试 + 真实 Edge 验收"分开记的能力，不能只看 scenes>0 就宣称已验证
        scene3d: o.spec.pagePlanReport?.features?.scene3d ?? null,
        // M7-B4C：创作意图（Scene Brief）+ 交叉校验 + 几何检查结果必须落盘，
        // 否则"构图为什么是这样"事后完全不可审计。
        sceneReview: o.spec.pagePlanReport?.sceneReview ?? null,
      }
      : null,
    createdAt: Date.now(),
    delivered: o.delivered,
    deliveryVersion: o.deliveryVersion,
    testSummary: o.testSummary,
    previewUrl: o.previewUrl,
    fileCount: Object.keys(o.files).length,
    hadDefectFix: o.hadDefectFix,
    galleryQuery: o.spec.galleryQuery ?? null,
    imageProvider: o.spec.provider ?? null,
    imageCount: o.spec.pagePlanUsed
      ? (o.spec.pagePlanReport?.features?.images ?? 0)
      : (o.spec.images?.length ?? 0),
  };
  try {
    fs.writeFileSync(path.join(o.ws, 'project.json'), JSON.stringify(meta, null, 2));
    fs.writeFileSync(path.join(o.ws, 'timeline.json'), JSON.stringify(cues));
  } catch (err) {
    console.error('[pipeline] persist failed:', err.message);
  }
}
