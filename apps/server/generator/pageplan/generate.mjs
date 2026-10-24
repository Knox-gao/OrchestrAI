import { validatePagePlan, PAGEPLAN_FIELD_CONTRACT, PAGEPLAN_NODE_KEYS, PAGEPLAN_ENUMS } from './schema.mjs';
import { listExtensionPagePlanTypes } from './registry.mjs';
import { normalizeProviderUsage } from './usage-normalizer.mjs';
import { SCENE3D_PRIMITIVES, SCENE3D_COMPOSITES, SCENE3D_MATERIALS, SCENE3D_LIMITS } from './scene3d.mjs';
import { SCENE_BRIEF_VERSION, SCENE_BRIEF_LIMITS } from './scene-brief.mjs';

export const PAGEPLAN_BASE_CAPABILITIES = Object.freeze([
  'section', 'container', 'heading', 'text', 'image', 'link', 'card', 'list',
  'details', 'timeline', 'metric', 'callout', 'divider', 'quote', 'search', 'filter', 'tabs',
]);

// This is deliberately limited to explicit 3D scene/model requests. A topic
// such as a city, island, or product alone must not silently force 3D.
const EXPLICIT_INTERACTIVE_3D_REQUEST = /\b(?:interactive\s+)?3d\s+(?:scene|model|viewer|world|experience)\b|\bthree[- ]dimensional\s+(?:scene|model|world)\b|\bwebgl\b|\b3d\b.{0,24}\b(?:interactive|orbit|rotat\w*|drag)\w*|\b(?:interactive|orbit|rotat\w*|drag)\w*.{0,24}\b3d\b|(?:交互(?:式)?|可旋转|拖拽旋转|可拖拽旋转).{0,8}(?:三维|3d|模型|场景)|(?:三维|3d)(?:交互场景|交互模型|场景|模型|世界|可视化)/i;

function requiresInteractive3D(requirement) {
  return EXPLICIT_INTERACTIVE_3D_REQUEST.test(String(requirement ?? ''));
}

function explicitlyTextOnly(requirement) {
  const text = String(requirement ?? '');
  const explicitTextOnlyPhrases = /纯文本(?:页面|网页|网站|布局|输出)?|纯文字(?:页面|网页|网站|布局|输出)?|只用文字|只要文字|仅用文字|仅文字|text[- ]only|only\s+(?:plain\s+)?text(?:\s+(?:website|site|page))?/gi;
  for (const match of text.matchAll(explicitTextOnlyPhrases)) {
    const prefix = text.slice(Math.max(0, match.index - 12), match.index);
    const suffix = text.slice(match.index + match[0].length, match.index + match[0].length + 16).replace(/^[\s，、：:。.!?！？]+/, '');
    const negatedPrefix = /(?:不要|不需要|不想要|不希望|不能|禁止|拒绝|避免|无需|别|不是|并非|没有要求|没要求|未明确要求|未要求|没有|没|未|not|no|without)[^。！？.!?\n]{0,8}$/i.test(prefix);
    const negatedSuffix = /^(?:不行|不可以|不接受|不希望|不能|不要|不满意|不够|太简陋|太朴素|过于简单|不好|不理想|is not|isn't|isn't wanted|not wanted)/i.test(suffix);
    if (!negatedPrefix && !negatedSuffix) return true;
  }
  return false;
}

/**
 * Prevent a structurally valid plan from becoming a bare sequence of headings
 * and paragraphs. Image search intent counts before search; after search only
 * an image that actually resolved counts as media.
 */
export function assessPagePlanVisualComposition(plan, requirement = '', { includeSearchIntents = true } = {}) {
  const nodes = [];
  const visit = (items) => {
    for (const node of items ?? []) {
      nodes.push(node);
      if (node.type === 'details') continue;
      if (node.type === 'tabs') {
        const initial = (node.panels ?? []).find((panel) => panel.id === node.initialTab);
        if (initial) visit(initial.children);
      } else if (Array.isArray(node.children)) visit(node.children);
    }
  };
  visit(plan?.nodes);
  const count = (type) => nodes.filter((node) => node.type === type).length;
  const images = nodes.filter((node) => node.type === 'image' && (
    Boolean(String(node.src ?? '').trim()) || (includeSearchIntents && Boolean(String(node.searchQuery ?? '').trim()))
  )).length;
  const scenes = count('scene3d');
  const cards = count('card');
  const metrics = count('metric');
  const timelines = count('timeline');
  const quotes = count('quote');
  const callouts = count('callout');
  const splitOrGrid = nodes.filter((node) => node.type === 'container' && ['split', 'grid'].includes(node.layout)).length;
  const accentedSections = nodes.filter((node) => node.type === 'section' && ['panel', 'contrast'].includes(node.variant)).length;
  const visualGroups = [cards >= 2, metrics >= 1, timelines >= 1, quotes >= 1, callouts >= 1, splitOrGrid >= 1, accentedSections >= 2].filter(Boolean).length;
  const textOnly = explicitlyTextOnly(requirement);
  const sectionCount = nodes.filter((node) => node.type === 'section').length;
  const targetImages = textOnly ? 0 : Math.min(6, Math.max(3, Math.ceil(sectionCount * 0.8)));
  const sufficient = textOnly || images >= targetImages;
  return {
    ok: sufficient,
    textOnly,
    metrics: { images, scenes, cards, metrics, timelines, quotes, callouts, splitOrGrid, accentedSections, visualGroups },
    targetImages,
    reason: sufficient ? '' : `PagePlan 可见配图不足：当前 ${images} 个图位，至少需要 ${targetImages} 个彼此有区分的主题图片图位。除非用户明确要求纯文字网站，否则不能只靠卡片、指标或 3D 场景代替图片。`,
  };
}

function injectTopicImagesToTarget(plan, requirement) {
  if (explicitlyTextOnly(requirement)) return plan;
  const assessment = assessPagePlanVisualComposition(plan, requirement);
  const missing = assessment.targetImages - assessment.metrics.images;
  if (missing <= 0) return plan;
  const nodes = [];
  const visibleSections = [];
  const visit = (items) => {
    for (const node of items ?? []) {
      nodes.push(node);
      if (Array.isArray(node.children)) visit(node.children);
      if (node.type === 'tabs') for (const panel of node.panels ?? []) visit(panel.children);
    }
  };
  visit(plan.nodes);
  const visitVisible = (items) => {
    for (const node of items ?? []) {
      if (node.type === 'section') visibleSections.push(node);
      if (node.type === 'details') continue;
      if (node.type === 'tabs') {
        const initial = (node.panels ?? []).find((panel) => panel.id === node.initialTab);
        if (initial) visitVisible(initial.children);
      } else if (Array.isArray(node.children)) visitVisible(node.children);
    }
  };
  visitVisible(plan.nodes);
  const usedIds = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    if (node.type === 'tabs') for (const panel of node.panels ?? []) usedIds.add(panel.id);
    if (node.type === 'scene3d') for (const object of node.objects ?? []) usedIds.add(object.id);
  }
  let id = 'topic-illustration';
  let suffix = 2;
  while (usedIds.has(id)) id = `topic-illustration-${suffix++}`;
  const title = String(plan.meta.title ?? '主题').trim();
  const visibleImageCount = (items) => {
    let count = 0;
    const walk = (children) => {
      for (const node of children ?? []) {
        if (node.type === 'image') count++;
        if (node.type === 'details') continue;
        if (node.type === 'tabs') {
          const active = node.panels.find((panel) => panel.id === node.initialTab);
          if (active) walk(active.children);
        } else if (Array.isArray(node.children)) walk(node.children);
      }
    };
    walk(items);
    return count;
  };
  const collectBrief = (items) => (items ?? []).flatMap((node) => [
    node.text, node.title, node.description, node.eyebrow,
  ].filter(Boolean)).join(' ');
  let added = 0;
  const prioritizedSections = [
    ...visibleSections.filter((section) => section.variant === 'hero'),
    ...visibleSections.filter((section) => section.variant !== 'hero'),
  ];
  for (const section of prioritizedSections) {
    if (added >= missing) break;
    if (visibleImageCount(section.children) > 0) continue;
    let imageId = added === 0 ? id : `topic-illustration-${suffix++}`;
    while (usedIds.has(imageId)) imageId = `topic-illustration-${suffix++}`;
    usedIds.add(imageId);
    const subject = [title, section.title, String(section.description ?? '').slice(0, 65), collectBrief(section.children).slice(0, 45)]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').slice(0, 145);
    const composition = added === 0 ? 'establishing photograph, wide editorial composition' : `editorial photograph, distinct scene and angle ${added + 1}`;
    const image = {
      id: imageId,
      type: 'image',
      alt: `${section.title || title}主题配图`.slice(0, 300),
      caption: section.title || title,
      searchQuery: `${subject} ${composition}`.slice(0, 240),
    };
    const firstAction = section.children.findIndex((node) => node.type === 'link');
    const firstContent = section.children.findIndex((node) => node.type === 'text' || node.type === 'container');
    const at = firstAction >= 0 ? firstAction : firstContent >= 0 ? firstContent + 1 : section.children.length;
    section.children.splice(at, 0, image);
    added++;
  }
  const shortPageSection = prioritizedSections[0];
  const fallbackTarget = shortPageSection?.children ?? plan.nodes;
  while (added < missing) {
    let imageId = `topic-illustration-${suffix++}`;
    while (usedIds.has(imageId)) imageId = `topic-illustration-${suffix++}`;
    usedIds.add(imageId);
    fallbackTarget.push({
      id: imageId,
      type: 'image',
      alt: `${title}主题细节配图 ${added + 1}`.slice(0, 300),
      caption: `${title} · 视觉细节 ${added + 1}`,
      searchQuery: `${title} ${String(requirement ?? '').slice(0, 100)} ${added % 2 ? 'close-up editorial photograph, tactile detail' : 'environmental editorial photograph, wide scene'}`.replace(/\s+/g, ' ').slice(0, 240),
    });
    added++;
  }
  return plan;
}
// scene3d 默认不开放：调用方必须显式把它加入 availableCapabilities 才启用。
// 本仓库已在真实 Edge（32/32）与 ZIP file://（18/18）验收，因此 pipeline 会显式传入。


// 把渲染器真实具备的能力写进 prompt。
// 审计发现旧 prompt 硬编码了 7 类基础 shape，而新增的 8 类复合原语
// （terrain/plateau/house/lighthouse/tree/shrub/rock/dock）从未被告知模型，
// 导致"fixture 里视觉很好、真实模型永远只会堆球柱方块"。
const SHAPE_LIST = [...SCENE3D_COMPOSITES, ...SCENE3D_PRIMITIVES].join(', ');
const MATERIAL_LIST = [...SCENE3D_MATERIALS].join(', ');
const COMPOSITE_HINT = SCENE3D_COMPOSITES.join(', ');

// Provider output limits vary, including among OpenAI-compatible gateways.
// Keep the measured DeepSeek default while allowing operators to set a
// provider-specific budget without editing source. Ignore malformed values.
export function pagePlanMaxTokens() {
  const configured = Number(process.env.ORCHESTRAI_PAGEPLAN_MAX_TOKENS);
  return Number.isInteger(configured) && configured >= 1000 && configured <= 100000
    ? configured
    : 20000;
}

const SCENE3D_PROMPT = `3D REQUIREMENT TRIGGER: Read the user's requirement, not just the requested page genre. If it explicitly asks for a three-dimensional/3D scene, interactive 3D model, WebGL scene, orbit/drag-to-rotate 3D view, or an explorable 3D world, and "scene3d" is in registeredRendererCapabilities, you MUST include a scene3d node and its top-level sceneBrief. Do not satisfy such a request with a 2D illustration, a static card, or prose describing a 3D scene. If "scene3d" is unavailable and the 3D experience is central to the request, report it as blocking in unsupportedRequests; never silently downgrade it. Do not add scene3d just because the page topic is a physical place or object when the user did not request a 3D experience.
When a 3D scene is required, you must also emit a top-level "sceneBrief" object with schemaVersion "${SCENE_BRIEF_VERSION}". It is a structured creative plan, not prose: theme, visualStyle, subject{id,description,silhouette}, secondaryFocus[], composition{cameraAngle(low|eye|high|isometric), subjectCoverage[min,max] (0.05-0.95, share of frame the subject should fill), whitespace(tight|balanced|airy), focalPoint}, terrain{kind,relief(flat|gentle|rolling|steep),layers[]}, objects[{id,role(subject|secondary|accent),scaleHint(tiny|small|medium|large|huge),layer(foreground|midground|background),relation}], materials[{name,intent}], light{direction,mood}, interaction[], acceptance[] (1-${SCENE_BRIEF_LIMITS.maxAcceptance} checkable statements). Exactly one object must have role=subject, and subject.id must appear in objects. objects must span at least two depth layers.
Scene3d node constraints: 1-${SCENE3D_LIMITS.maxObjects} objects. Allowed shapes: ${SHAPE_LIST}. Prefer the composite shapes (${COMPOSITE_HINT}) over stacking raw primitives: a house is ONE object with shape "house" (it already renders walls, gabled roof, door, windows, chimney), a palm is ONE object with shape "tree" (trunk plus fronds), a lighthouse is ONE object with shape "lighthouse" (base, tower, gallery, lantern, roof, lamp). Do NOT compose a house out of several boxes yourself — that is what produced "random stacked primitives". Use raw primitives only for genuinely simple props. Allowed materials: ${MATERIAL_LIST}. Each object: bounded position/scale/rotation triples, hex color, material, selectable flag, motion ("none" or "tide" only on shape "disk"). Coordinates are a rough layout hint: the renderer auto-frames the camera and snaps standing objects onto the terrain surface, so express intent through role/layer/relation instead of pixel-perfect coordinates.
Never claim physical refraction, PBR, shadow mapping, skeletal animation, or imported 3D models; the renderer does stylized mesh lighting and procedural geometry only.`;

/**
 * 字段契约段：由 schema 的真实白名单生成，不手写第二份。
 * M7-B4E 真实故障：deepseek 连续两次把 meta.locale / meta.projectTitle /
 * designIntent.layoutStrategy 塞进来——因为 prompt 只说了顶层字段名。
 * 现在把每个对象的允许字段直接列给模型，禁止它猜。
 */
const SCHEMA_CONTRACT_PROMPT = `FIELD CONTRACT (exact allowed keys; any extra key will be rejected by the validator):
- meta: only ${PAGEPLAN_FIELD_CONTRACT.meta.join(', ')} (no projectTitle/pageTitle/locale; use title/description/language)
- userConstraints: only ${PAGEPLAN_FIELD_CONTRACT.userConstraints.join(', ')}
- designIntent: only ${PAGEPLAN_FIELD_CONTRACT.designIntent.join(', ')} (no layoutStrategy/pageShell/template)
- theme: only ${PAGEPLAN_FIELD_CONTRACT.theme.join(', ')}; every color MUST be #RRGGBB (no rgb()/hsl()/named colors)
- Every node object: use ONLY the keys listed below for its type. Do not add className/style/layoutStrategy/template/props/content or any other field.
ENUM CONTRACT (these are the ONLY legal values; do not invent variants):
  * section.variant: ${PAGEPLAN_ENUMS.sectionVariant.join(", ")}
  * container.layout: ${PAGEPLAN_ENUMS.containerLayout.join(", ")}
  * link.variant: ${PAGEPLAN_ENUMS.linkVariant.join(", ")}
  * callout.tone: ${PAGEPLAN_ENUMS.calloutTone.join(", ")}
  * heading.level: ${PAGEPLAN_ENUMS.headingLevel.join(", ")}
  * container.columns (grid only): ${PAGEPLAN_ENUMS.gridColumns.join(", ")}
  * theme.fontMood: ${PAGEPLAN_ENUMS.fontMood.join(", ")}   (NO other values; not "elegant"/"modern"/"handwritten")
  * theme.density: ${PAGEPLAN_ENUMS.density.join(", ")}
  * theme.radius: ${PAGEPLAN_ENUMS.radius.join(", ")}

COMPLEX NODE STRUCTURE (nested shapes must match exactly):
  * card.tags: optional array of lowercase kebab-case tags, max 12, no duplicates (e.g. ["room","suite"])
  * search: { id, type:"search", targetId:<id of a container>, label, placeholder }
  * filter: { id, type:"filter", targetId:<id of a container>, label, options:[{tag,label}] } — 1-12 options;
      each option.tag MUST be a lowercase kebab-case tag that already exists in some card.tags of the target container.
      The target container must contain ONLY card children.
  * tabs: { id, type:"tabs", label, initialTab:<panel id>, panels:[{id,label,children:[...]}] } — 2-8 panels;
      panel.id must be lowercase kebab-case; initialTab must equal one of the panel ids.
  * list.items: array of objects, each ONLY { title?, text } (text required; title optional). No id/body/desc.
  * timeline.items: array of objects, each ONLY { id, date, title, body } — id is required lowercase kebab-case.
  * metrics: { id, type:"metric", value, label, detail? }. callout: { id, type:"callout", title, body, tone }.
HARD INVARIANTS (violating any of these fails validation outright):
  * section.title is ALREADY rendered as the section heading. Do NOT repeat it as a heading child —
    that produces a duplicated H1/H2 on the page. Inside a section, start with text/container/card, not heading.
  * unsupportedRequests MUST be present as an array (use [] when nothing is unsupported; max 30 items).
  * Every "children" array MUST be non-empty. Do not emit children: [] — omit the node instead.
  * tabs.panels[].children MUST be non-empty arrays.
  * container with grid layout: columns must be 2, 3 or 4.
  * All ids (node ids, panel ids, timeline item ids) must be lowercase kebab-case starting with a letter.
${Object.entries(PAGEPLAN_NODE_KEYS).map(([k, v]) => "  * " + k + ": " + v.join(", ")).join("\n")}`;

const SYSTEM_PROMPT = `You are the structural creative director for OrchestrAI. Return exactly one JSON object: no prose, no markdown fences, no HTML, no CSS, no JavaScript, no executable code.
Design a desktop-first website using the OrchestrAI PagePlan v1 declarative schema. The plan must express the actual information architecture and composition in the nodes tree; do not choose a stock template and merely change its text or colors.
Allowed node types are exactly the registered capability list in the user payload. Built-in types include section, container, heading, text, image, link, card, list, details, timeline, metric, callout, divider, quote, search, filter and tabs. scene3d is unavailable unless it explicitly appears in the caller-supplied capability list. Never emit a capability outside that list. Do not invent renderer capabilities.
Node constraints: every node has a unique kebab-case id. section requires title and non-empty children; container.layout is stack/split/grid; grid columns are 2, 3 or 4; heading.level is 1/2/3; all displayed content is plain text. Unless the user explicitly requests a text-only website, you MUST include at least one image node with a specific searchQuery describing a subject that belongs on this page. For an ordinary multi-section page use 3–6 visible image nodes, about one purposeful visual per major content area; use distinct, concrete searchQuery values and scene angles, never repeat a generic query to inflate the count. Prefer authentic photos for real products, places, people, food, architecture, and vehicles; avoid unrelated stock imagery, logos, generic abstract backgrounds, AI renders, and illustrations when a real photo fits. Keep images in active page content across sections, outside details and inactive tabs. Place the strongest, most relevant illustration or photograph in the hero or first content section, with a meaningful alt and concise caption. Do not omit imagery just because the user did not say "photo" or because search may fail; the renderer creates a topic-directed vector illustration when no suitable, clear result can be sourced. Never invent image URLs or use placeholder/example domains, localhost, data: or file URLs. A page with only text, cards, metrics, a timeline, or a 3D scene is not acceptable unless text-only was explicitly requested. Every image must include meaningful alt text. Links may use fragment anchors, safe relative paths or HTTPS URLs. Never emit script nodes, inline JS, CSS strings, event-handler properties, raw HTML, data URLs, file URLs or javascript URLs. For requests requiring an actual interactive three-dimensional scene, use a scene3d node only when the capability is listed, and follow the SCENE3D rules appended below. If the scene is essential and this renderer is not listed as available, declare a blocking unsupportedRequests item rather than returning a 2D imitation.
Create a substantive composition, not an arbitrary pile of cards. Select the appropriate page structure for the user's actual intent. Describe visual principles concretely. Preserve every explicitly locked user choice exactly. If a requested capability is not in the allowed node/extension list, do not pretend it is implemented; add an unsupportedRequests item with a requirementId, capability, reason and severity. Use blocking when the unavailable capability is essential to the user's core request; use nonblocking only when the core deliverable remains meaningfully useful.
TYPOGRAPHY AND RHYTHM: Establish a clear reading hierarchy: one dominant hero title, section titles for major topics, and smaller headings only for genuine subsections. Keep paragraphs readable and concise; use lists, timelines, metrics, quotes, or callouts when their information shape fits. For pages with several sections, vary the composition across sections instead of repeating the same grid or panel pattern. Use card grids only for genuinely parallel items such as products, people, or options; do not turn narrative, process, or editorial content into generic cards. Use hero, plain, panel, and contrast section variants with intent, and avoid wrapping every section in a panel. Do not invent content or add visual components merely to force variety.
Output top-level fields: schemaVersion, meta, userConstraints, designIntent, theme, nodes, unsupportedRequests. Each unsupportedRequests item must contain {requirementId, capability, reason, severity}, where severity is blocking or nonblocking. When the request requires a capability that is not in the provided registered capability list, disclose it. A core requested capability that cannot be implemented must use severity=blocking. Do not author your own "known limitations" / "未实现" section or callout inside nodes: the renderer appends one limitations block derived from unsupportedRequests, so authoring your own would duplicate it. The caller will resolve locked choices and canonical theme tokens before validation, so do not reinterpret user choices.
${SCHEMA_CONTRACT_PROMPT}
${SCENE3D_PROMPT}`;

export class PagePlanGenerationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PagePlanGenerationError';
    this.code = code;
    this.details = details;
  }
}

function strictJson(text) {
  if (typeof text !== 'string') throw new PagePlanGenerationError('MODEL_EMPTY', '模型未返回文本');
  let candidate = text.trim();
  const fenced = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) candidate = fenced[1].trim();
  if (!candidate.startsWith('{') || !candidate.endsWith('}')) {
    throw new PagePlanGenerationError('MODEL_NOT_JSON', '模型输出不是完整的 JSON 对象');
  }
  try { return JSON.parse(candidate); }
  catch (error) {
    throw new PagePlanGenerationError('MODEL_INVALID_JSON', '模型返回的 JSON 无法解析', { parseMessage: String(error?.message ?? error).slice(0, 160) });
  }
}

function normalizeChoice(value, name) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > 80) {
    throw new PagePlanGenerationError('INVALID_LOCKED_CHOICE', `锁定选择 ${name} 的格式无效`);
  }
  return value.trim();
}

function summarizeIssues(error) {
  if (Array.isArray(error?.issues)) return error.issues.slice(0, 8).join('; ');
  return String(error?.message ?? error).replace(/(?:Bearer\s+)[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]').slice(0, 400);
}

/**
 * Request a declarative PagePlan through the existing BYOK gateway.
 * `callModel` should be the repository's `chat(gw, messages, options)` function.
 * `resolveTheme` must map canonical style IDs to validated repository-owned tokens.
 * This module does not fall back to parseSentence/template generation on failure.
 */
export async function generatePagePlan({
  requirement,
  projectTitle = '',
  gw,
  userChoices = {},
  allowedStyleIds,
  availableCapabilities = PAGEPLAN_BASE_CAPABILITIES,
  requiredRequirementIds = [],
  resolveTheme,
  callModel,
  maxAttempts = 2,
  // 可选：每次尝试结束后的观测回调（success / 分类失败）。上层用它写真实事件流，
  // 而不是靠"最后成功了"来推断中间发生过重试。
  onAttempt = null,
}) {
  if (!gw) throw new PagePlanGenerationError('MODEL_REQUIRED', '未配置可用模型网关');
  if (typeof callModel !== 'function') throw new PagePlanGenerationError('MODEL_ADAPTER_MISSING', '缺少模型网关调用适配器');
  if (typeof resolveTheme !== 'function') throw new PagePlanGenerationError('THEME_RESOLVER_MISSING', '缺少官方风格 token 解析器');
  if (typeof requirement !== 'string' || !requirement.trim()) throw new PagePlanGenerationError('REQUIREMENT_EMPTY', '网站需求不能为空');
  if (!Array.isArray(allowedStyleIds) || allowedStyleIds.length === 0 || allowedStyleIds.some((x) => typeof x !== 'string' || !x.trim())) {
    throw new PagePlanGenerationError('STYLE_REGISTRY_EMPTY', '没有可用的规范风格 ID 列表');
  }
  if (!Array.isArray(requiredRequirementIds) || requiredRequirementIds.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(id))) {
    throw new PagePlanGenerationError('INVALID_REQUIRED_REQUIREMENTS', 'requiredRequirementIds 必须是可信调用方提供的稳定 ID 列表');
  }
  const requiredIds = new Set(requiredRequirementIds);
  const capabilitySet = new Set([...availableCapabilities, ...listExtensionPagePlanTypes()]);
  const requires3D = requiresInteractive3D(requirement);
  if (requires3D && !capabilitySet.has('scene3d')) {
    throw new PagePlanGenerationError('PAGEPLAN_CAPABILITY_UNAVAILABLE', '需求明确要求交互式 3D 场景，但当前渲染能力未启用 scene3d；已阻断 PagePlan 生成，未发起本次页面生成模型请求。');
  }
  const attempts = Math.max(1, Math.min(3, Number.isInteger(maxAttempts) ? maxAttempts : 2));
  const locks = {
    styleId: normalizeChoice(userChoices.styleId, 'styleId'),
    fontMood: normalizeChoice(userChoices.fontMood, 'fontMood'),
    pageDirection: normalizeChoice(userChoices.pageDirection, 'pageDirection'),
  };
  if (locks.fontMood && !['serif', 'sans', 'mono'].includes(locks.fontMood)) {
    throw new PagePlanGenerationError('INVALID_LOCKED_CHOICE', 'fontMood 必须是 serif、sans 或 mono');
  }
  if (locks.styleId && !allowedStyleIds.includes(locks.styleId)) {
    throw new PagePlanGenerationError('INVALID_LOCKED_CHOICE', '用户锁定的 styleId 不在当前风格注册表中；必须先做规范 ID 映射');
  }

  let lastError = null;
  let previousIssue = '';
  const started = performance.now();
  // 记录**实际**执行到第几次，用于最终错误信息（不能把配置上限当实际次数）。
  let attemptsUsed = 0;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    attemptsUsed = attempt;
    // M7-B4D：保留本轮模型的**原始文本**，用于审计"JSON 为什么非法"，
    // 而不是只留一句 reason。截断到 60000 字符，避免异常巨大响应拖垮存储。
    let attemptRawText = null;
    try {
      const payload = {
        projectTitle: String(projectTitle).slice(0, 180),
        requirement: requirement.slice(0, 12000),
        lockedUserChoices: locks,
        trustedRequiredRequirementIds: [...requiredIds],
        allowedCanonicalStyleIds: allowedStyleIds,
        registeredRendererCapabilities: [...capabilitySet],
        previousValidationIssue: previousIssue || undefined,
        expectedSchemaVersion: 'orchestrai.pageplan.v1',
      };
      const modelResponse = await callModel(gw, [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(payload) },
      ], { temperature: 0.25, maxTokens: pagePlanMaxTokens() });
      const text = typeof modelResponse === 'string' ? modelResponse : (typeof modelResponse?.text === 'string' ? modelResponse.text : typeof modelResponse?.content === 'string' ? modelResponse.content : null);
      attemptRawText = typeof text === 'string' ? text.slice(0, 60000) : null;
      const providerUsage = normalizeProviderUsage(modelResponse);
      const draft = strictJson(text);
      if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
        throw new PagePlanGenerationError('MODEL_INVALID_PLAN', '模型没有返回 PagePlan 对象');
      }
      if (!draft.theme || typeof draft.theme !== 'object') {
        throw new PagePlanGenerationError('MODEL_MISSING_THEME', 'PagePlan 缺少 theme 对象');
      }
      const requestedStyleId = locks.styleId ?? draft.theme.styleId;
      if (typeof requestedStyleId !== 'string' || !allowedStyleIds.includes(requestedStyleId)) {
        throw new PagePlanGenerationError('MODEL_UNKNOWN_STYLE', '模型选择了未注册的 styleId');
      }
      const requestedFontMood = locks.fontMood ?? draft.theme.fontMood;
      if (!['serif', 'sans', 'mono'].includes(requestedFontMood)) {
        throw new PagePlanGenerationError('MODEL_UNKNOWN_FONT', 'PagePlan 选择了不支持的 fontMood');
      }
      const requestedDirection = locks.pageDirection ?? draft.designIntent?.pageDirection;
      if (typeof requestedDirection !== 'string' || !requestedDirection.trim() || requestedDirection.length > 80) {
        throw new PagePlanGenerationError('MODEL_INVALID_DIRECTION', 'PagePlan 缺少有效的页面方向');
      }

      let themeTokens;
      try {
        themeTokens = await resolveTheme({
          styleId: requestedStyleId,
          fontMood: requestedFontMood,
          suggestedTheme: structuredClone(draft.theme),
          locked: { ...locks },
        });
      } catch (error) {
        throw new PagePlanGenerationError('THEME_RESOLUTION_FAILED', `无法解析规范风格 token：${String(error?.message ?? error).slice(0, 180)}`);
      }
      if (!themeTokens || typeof themeTokens !== 'object') {
        throw new PagePlanGenerationError('THEME_RESOLUTION_FAILED', '风格 token 解析器没有返回有效对象');
      }
      // M7-B4E：resolveTheme 必须给出完整主题，否则会静默产生非法 theme
      // （实测：只返回 {styleId} 时，density/radius 变成 undefined 并被 schema 拒绝）。
      const REQUIRED_THEME_FIELDS = ['background', 'surface', 'text', 'muted', 'accent', 'accentSoft', 'density', 'radius'];
      const missingTheme = REQUIRED_THEME_FIELDS.filter((k) => themeTokens[k] == null);
      if (missingTheme.length) {
        throw new PagePlanGenerationError('THEME_RESOLUTION_FAILED', `风格 token 解析器返回的主题不完整，缺少：${missingTheme.join(', ')}`);
      }

      const plan = {
        ...draft,
        userConstraints: { ...locks, locked: true },
        designIntent: { ...draft.designIntent, pageDirection: requestedDirection },
        theme: {
          ...themeTokens,
          styleId: requestedStyleId,
          fontMood: requestedFontMood,
        },
      };
      let validated = validatePagePlan(plan);
      if (!explicitlyTextOnly(requirement) && !assessPagePlanVisualComposition(validated, requirement).ok) {
        validated = validatePagePlan(injectTopicImagesToTarget(validated, requirement));
      }
      const visualAssessment = assessPagePlanVisualComposition(validated, requirement);
      if (!visualAssessment.ok) {
        throw new PagePlanGenerationError('PAGEPLAN_VISUAL_COMPOSITION_INSUFFICIENT', visualAssessment.reason, visualAssessment.metrics);
      }
      const hasScene3D = collectNodeTypes(validated.nodes).includes('scene3d');
      if (requires3D && (!hasScene3D || !validated.sceneBrief)) {
        throw new PagePlanGenerationError(
          'PAGEPLAN_REQUIRED_CAPABILITY_MISSING',
          !hasScene3D
            ? '需求明确要求交互式 3D 场景，但 PagePlan 未生成 scene3d 节点。'
            : 'PagePlan 已生成 scene3d，但缺少必需的 sceneBrief 创作与验收说明。',
        );
      }
      if (hasScene3D && !validated.sceneBrief) {
        throw new PagePlanGenerationError('PAGEPLAN_INVALID', 'PagePlan 使用 scene3d 时必须同时提供顶层 sceneBrief。');
      }
      const unsupportedTypes = collectNodeTypes(validated.nodes).filter((type) => !capabilitySet.has(type));
      if (unsupportedTypes.length) throw new PagePlanGenerationError('PAGEPLAN_CAPABILITY_UNAVAILABLE', `PagePlan 请求了未启用的能力：${[...new Set(unsupportedTypes)].join(', ')}`);
      const requiredDowngrades = validated.unsupportedRequests.filter((item) => requiredIds.has(item.requirementId) && item.severity !== 'blocking');
      if (requiredDowngrades.length) throw new PagePlanGenerationError('PAGEPLAN_REQUIRED_CAPABILITY_DOWNGRADED', '模型试图将用户确认的必需需求降级为非阻断限制', { requirementIds: requiredDowngrades.map((item) => item.requirementId) });
      const blocking = validated.unsupportedRequests.filter((item) => item.severity === 'blocking');
      if (blocking.length) {
        throw new PagePlanGenerationError('PAGEPLAN_BLOCKED', `模型识别到 ${blocking.length} 项阻断级不支持能力`, {
          unsupportedRequests: blocking.map(({ requirementId, capability, reason }) => ({ requirementId, capability, reason })),
        });
      }
      try { onAttempt?.({ attempt, attempts, ok: true, code: 'OK', rawText: attemptRawText }); } catch {}
      return {
        plan: validated,
        metadata: {
          provider: String(gw.provider ?? 'unknown'),
          model: String(gw.model ?? 'unknown'),
          attempts: attempt,
          elapsedMs: Math.round(performance.now() - started),
          // Existing chat() returns assistant text only; do not fabricate token usage.
          usage: providerUsage.usage,
          usageStatus: providerUsage.usageStatus,
          lockedChoiceFields: Object.keys(locks).filter((key) => locks[key] != null),
        },
      };
    } catch (error) {
      lastError = error;
      previousIssue = summarizeIssues(error);
      // M7-B4E：失败分类决定是否重试。外部取消/blocking/鉴权失败一律不重试。
      const verdict = describeAttemptFailure(error, { attempt, attempts });
      const willRetry = verdict.retryable && attempt < attempts;
      try {
        onAttempt?.({
          attempt, attempts, ok: false,
          code: error?.code ?? 'UNKNOWN',
          issue: previousIssue,
          rawText: attemptRawText,
          retryable: verdict.retryable,
          willRetry,
          diagnostic: { ...verdict.diagnostic, willRetry },
        });
      } catch {}
      if (!willRetry) break;
    }
  }
  throw new PagePlanGenerationError('PAGEPLAN_GENERATION_FAILED', `PagePlan 生成失败（实际尝试 ${attemptsUsed}/${attempts} 次${lastError?.code ? `，最后错误 ${lastError.code}` : ''}）；交付已阻断。`, {
    attempts: attemptsUsed,
    attemptsAllowed: attempts,
    lastCode: lastError?.code ?? 'UNKNOWN',
    lastIssue: summarizeIssues(lastError),
  });
}

/**
 * M7-B4E：把一次尝试失败翻译成「是否可重试」+「可安全记录的诊断信息」。
 *
 * 关键约束：
 *   - 外部取消（LLM_ABORTED）**不得**自动重试——重试等于绕过用户的取消意图；
 *   - 超时（LLM_TIMEOUT）可重试，但必须由调用方控制次数（本函数只给建议）；
 *   - 模型自己声明 blocking、能力不可用、鉴权失败都不可重试（重试结果必然相同）。
 *
 * 返回的 diagnostic 只含分类与时间，不含密钥、Authorization、请求头或完整响应体。
 */
export function describeAttemptFailure(error, { attempt, attempts } = {}) {
  const code = String(error?.code ?? 'UNKNOWN');
  const name = String(error?.name ?? 'Error');
  const message = String(error?.message ?? error ?? '').slice(0, 160);

  // 非可重试：重试也不会改变结果
  const fatal = new Set([
    'LLM_ABORTED',              // 外部取消 / 主动中止
    'PAGEPLAN_BLOCKED',         // 模型声明核心能力不支持
    'PAGEPLAN_REQUIRED_CAPABILITY_DOWNGRADED',
    'PAGEPLAN_CAPABILITY_UNAVAILABLE',
    'PAGEPLAN_ASSET_MISSING',
    'INVALID_LOCKED_CHOICE',
    'MODEL_REQUIRED',
    'MODEL_ADAPTER_MISSING',
    'THEME_RESOLVER_MISSING',
    'STYLE_REGISTRY_EMPTY',
    'REQUIREMENT_EMPTY',
    'INVALID_REQUIRED_REQUIREMENTS',
  ]);
  // 可重试：瞬时故障或模型偶发输出问题
  const transient = new Set([
    'LLM_TIMEOUT',
    'MODEL_EMPTY',
    'MODEL_NOT_JSON',
    'MODEL_INVALID_JSON',
    'MODEL_INVALID_PLAN',
    'MODEL_MISSING_THEME',
    'PAGEPLAN_INVALID',          // schema 校验失败：错误会通过 previousValidationIssue 回传，模型有机会自我修正
    'PAGEPLAN_VISUAL_COMPOSITION_INSUFFICIENT', // 避免仅凭用户未提照片就输出纯文本页
    'PAGEPLAN_REQUIRED_CAPABILITY_MISSING', // 明确要求的 3D 场景缺失：反馈具体错误后允许模型自我修正一次
    // 同属"模型写了非法值"：错误信息会通过 previousValidationIssue 回传，重试有实质机会。
    'MODEL_UNKNOWN_STYLE',
    'MODEL_UNKNOWN_FONT',
    'MODEL_INVALID_DIRECTION',
    'LLM_OUTPUT_TRUNCATED',      // 输出被截断：换预算/重试可能成功
    'LLM_EMPTY_CONTENT',         // 空内容：偶发，可重试
  ]);

  let retryable;
  if (fatal.has(code)) retryable = false;
  else if (transient.has(code)) retryable = true;
  else if (/^LLM HTTP 4dd/.test(message) && !/^LLM HTTP 429/.test(message)) retryable = false; // 4xx 除 429 外不重试
  else if (/^LLM HTTP 429/.test(message)) retryable = true;
  else if (/^LLM HTTP 5dd/.test(message)) retryable = true;
  else retryable = false;   // 未知原因默认不重试（宁可少发请求，也不浪费额度）

  return {
    retryable,
    reason: retryable ? 'transient_failure' : 'non_retryable_failure',
    diagnostic: {
      attempt: attempt ?? null,
      attempts: attempts ?? null,
      code,
      errorName: name,
      // 只保留分类，不记录 message 原文里可能出现的 URL/密钥（message 已在 summarizeIssues 侧截断并脱敏）
      classification: error?.classification ?? null,
      timedOut: error?.details?.timedOut ?? null,
      elapsedMs: error?.details?.elapsedMs ?? null,
      enteredNetwork: error?.details?.enteredNetwork ?? null,
      retryable,
    },
  };
}

function collectNodeTypes(nodes, out = []) { for (const node of nodes ?? []) { out.push(node.type); if (Array.isArray(node.children)) collectNodeTypes(node.children, out); if (node.type === 'tabs') for (const panel of node.panels ?? []) collectNodeTypes(panel.children, out); } return out; }
