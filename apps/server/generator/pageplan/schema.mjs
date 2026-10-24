import { getPagePlanRenderer, isBuiltinPagePlanType } from './registry.mjs';
import { validateScene3DNode } from './scene3d.mjs';
import { validateInteractionNode } from './interactions.mjs';
import { validateSceneBrief } from './scene-brief.mjs';

export const PAGEPLAN_SCHEMA_VERSION = 'orchestrai.pageplan.v1';
export const PAGEPLAN_LIMITS = Object.freeze({
  maxNodes: 240,
  maxDepth: 9,
  maxString: 12_000,
  maxItems: 80,
  maxVisualPrinciples: 12,
  maxVisualPrincipleLength: 220,
});

const ID_RE = /^[a-z][a-z0-9-]{0,49}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const FONT_MOODS = new Set(['serif', 'sans', 'mono']);
const DENSITIES = new Set(['airy', 'comfortable', 'compact']);
const RADII = new Set(['sharp', 'soft', 'rounded', 'pill']);
/**
 * 枚举契约：这些是唯一合法的取值。prompt 直接从它生成，避免模型猜测。
 * M7-B4E：模型反复给出 variant: "feature"/"list"/"cta" 等自造值。
 */
export const PAGEPLAN_ENUMS = Object.freeze({
  sectionVariant: ['plain', 'hero', 'panel', 'contrast'],
  containerLayout: ['stack', 'split', 'grid'],
  linkVariant: ['primary', 'secondary', 'quiet'],
  calloutTone: ['info', 'success', 'warning', 'neutral'],
  headingLevel: [1, 2, 3],
  gridColumns: [2, 3, 4],
  // M7-B4E：这三个之前没暴露给模型，导致 MODEL_UNKNOWN_FONT（实测故障）。
  fontMood: ['serif', 'sans', 'mono'],
  density: ['airy', 'comfortable', 'compact'],
  radius: ['sharp', 'soft', 'rounded', 'pill'],
});

const SECTION_VARIANTS = new Set(['plain', 'hero', 'panel', 'contrast']);
const CONTAINER_LAYOUTS = new Set(['stack', 'split', 'grid']);
const LINK_VARIANTS = new Set(['primary', 'secondary', 'quiet']);
const CALLOUT_TONES = new Set(['info', 'success', 'warning', 'neutral']);
/**
 * 字段契约：每个顶层对象的**允许字段**。
 * prompt 从这里生成（见 generate.mjs），因此无需人工维护两份白名单。
 * M7-B4E 真实故障背景：模型反复把 meta.locale / meta.projectTitle / designIntent.layoutStrategy
 * 塞进来，因为 prompt 只说了顶层字段名、从没给出子字段白名单——它只能靠猜。
 */
export const PAGEPLAN_FIELD_CONTRACT = Object.freeze({
  meta: ['title', 'description', 'language'],
  userConstraints: ['styleId', 'fontMood', 'pageDirection', 'locked'],
  designIntent: ['concept', 'pageDirection', 'visualPrinciples'],
  theme: ['styleId', 'background', 'surface', 'text', 'muted', 'accent', 'accentSoft', 'fontMood', 'density', 'radius'],
});

export const PAGEPLAN_NODE_KEYS = {
  section: ['id', 'type', 'label', 'eyebrow', 'title', 'description', 'variant', 'children'],
  container: ['id', 'type', 'layout', 'columns', 'children'],
  heading: ['id', 'type', 'level', 'text'],
  text: ['id', 'type', 'text'],
  image: ['id', 'type', 'src', 'alt', 'caption', 'searchQuery'],
  link: ['id', 'type', 'label', 'href', 'variant'],
  card: ['id', 'type', 'eyebrow', 'title', 'description', 'tags', 'children'],
  list: ['id', 'type', 'items'],
  details: ['id', 'type', 'summary', 'children'],
  timeline: ['id', 'type', 'items'],
  metric: ['id', 'type', 'label', 'value', 'detail'],
  callout: ['id', 'type', 'title', 'body', 'tone'],
  divider: ['id', 'type'],
  quote: ['id', 'type', 'text', 'byline'],
  search: ['id', 'type', 'targetId', 'label', 'placeholder'],
  filter: ['id', 'type', 'targetId', 'label', 'options'],
  tabs: ['id', 'type', 'label', 'initialTab', 'panels'],
  scene3d: ['id', 'type', 'label', 'description', 'height', 'background', 'cameraDistance', 'controls', 'objects', 'shadows', 'groundColor'],
};

export class PagePlanValidationError extends Error {
  constructor(issues) {
    super(`PagePlan validation failed (${issues.length} issue${issues.length === 1 ? '' : 's'}): ${issues.slice(0, 5).join('; ')}`);
    this.name = 'PagePlanValidationError';
    this.code = 'PAGEPLAN_INVALID';
    this.issues = issues;
  }
}

function ownKeysOnly(obj, allowed, path, issues) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) issues.push(`${path}: unsupported property "${key}"`);
  }
}
function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function checkString(value, path, issues, { required = true, max = 500, allowEmpty = false } = {}) {
  if (typeof value !== 'string') {
    if (!required && value == null) return;
    issues.push(`${path}: expected string`); return;
  }
  if (value.length > max) issues.push(`${path}: exceeds ${max} characters`);
  if (!allowEmpty && required && !value.trim()) issues.push(`${path}: must not be empty`);
}
function checkEnum(value, values, path, issues, { required = true } = {}) {
  if (!required && value == null) return;
  if (typeof value !== 'string' || !values.has(value)) issues.push(`${path}: unsupported value`);
}
function checkColor(value, path, issues) {
  if (typeof value !== 'string' || !HEX_RE.test(value)) issues.push(`${path}: expected #RRGGBB`);
}

/**
 * Validate a PagePlan at the trust boundary. Unknown fields/types are rejected instead of
 * silently discarded. This prevents a model from believing an unsupported behavior shipped.
 */
export function validatePagePlan(input, options = {}) {
  const limits = { ...PAGEPLAN_LIMITS, ...(options.limits ?? {}) };
  const issues = [];
  if (!plainObject(input)) throw new PagePlanValidationError(['$: expected plain object']);
  // sceneBrief 是 M7-B4C 新增的可选字段：用于结构化创作意图。
  // 保持向后兼容——旧计划不带它仍合法；带它则必须通过 scene-brief 的结构校验。
  ownKeysOnly(input, ['schemaVersion', 'meta', 'userConstraints', 'designIntent', 'theme', 'nodes', 'unsupportedRequests', 'sceneBrief'], '$', issues);
  if (input.schemaVersion !== PAGEPLAN_SCHEMA_VERSION) issues.push(`schemaVersion: expected ${PAGEPLAN_SCHEMA_VERSION}`);

  if (input.sceneBrief != null) {
    try {
      validateSceneBrief(input.sceneBrief);
    } catch (e) {
      issues.push(`sceneBrief: ${String(e?.message ?? e).slice(0, 300)}`);
    }
  }

  if (!plainObject(input.meta)) issues.push('meta: expected object');
  else {
    ownKeysOnly(input.meta, ['title', 'description', 'language'], 'meta', issues);
    checkString(input.meta.title, 'meta.title', issues, { max: 180 });
    checkString(input.meta.description, 'meta.description', issues, { max: 600 });
    checkString(input.meta.language, 'meta.language', issues, { max: 20 });
  }

  if (!plainObject(input.userConstraints)) issues.push('userConstraints: expected object');
  else {
    ownKeysOnly(input.userConstraints, ['styleId', 'fontMood', 'pageDirection', 'locked'], 'userConstraints', issues);
    checkString(input.userConstraints.styleId, 'userConstraints.styleId', issues, { max: 80, required: false });
    checkString(input.userConstraints.fontMood, 'userConstraints.fontMood', issues, { max: 20, required: false });
    checkString(input.userConstraints.pageDirection, 'userConstraints.pageDirection', issues, { max: 80, required: false });
    if (input.userConstraints.locked !== true) issues.push('userConstraints.locked: must be true; confirmed choices are immutable');
  }

  if (!plainObject(input.designIntent)) issues.push('designIntent: expected object');
  else {
    ownKeysOnly(input.designIntent, ['concept', 'pageDirection', 'visualPrinciples'], 'designIntent', issues);
    checkString(input.designIntent.concept, 'designIntent.concept', issues, { max: 700 });
    checkString(input.designIntent.pageDirection, 'designIntent.pageDirection', issues, { max: 80 });
    if (!Array.isArray(input.designIntent.visualPrinciples) || input.designIntent.visualPrinciples.length > PAGEPLAN_LIMITS.maxVisualPrinciples) {
      issues.push(`designIntent.visualPrinciples: expected array with at most ${PAGEPLAN_LIMITS.maxVisualPrinciples} items`);
    } else input.designIntent.visualPrinciples.forEach((v, i) => checkString(v, `designIntent.visualPrinciples[${i}]`, issues, { max: PAGEPLAN_LIMITS.maxVisualPrincipleLength }));
  }

  if (!plainObject(input.theme)) issues.push('theme: expected object');
  else {
    ownKeysOnly(input.theme, ['styleId', 'background', 'surface', 'text', 'muted', 'accent', 'accentSoft', 'fontMood', 'density', 'radius'], 'theme', issues);
    checkString(input.theme.styleId, 'theme.styleId', issues, { max: 80 });
    for (const key of ['background', 'surface', 'text', 'muted', 'accent', 'accentSoft']) checkColor(input.theme[key], `theme.${key}`, issues);
    checkEnum(input.theme.fontMood, FONT_MOODS, 'theme.fontMood', issues);
    checkEnum(input.theme.density, DENSITIES, 'theme.density', issues);
    checkEnum(input.theme.radius, RADII, 'theme.radius', issues);
  }

  if (plainObject(input.userConstraints) && plainObject(input.theme)) {
    const c = input.userConstraints;
    if (c.styleId && input.theme.styleId !== c.styleId) issues.push('theme.styleId conflicts with locked user styleId');
    if (c.fontMood && input.theme.fontMood !== c.fontMood) issues.push('theme.fontMood conflicts with locked user fontMood');
    if (c.pageDirection && input.designIntent?.pageDirection !== c.pageDirection) issues.push('designIntent.pageDirection conflicts with locked user pageDirection');
  }

  if (!Array.isArray(input.nodes) || input.nodes.length === 0) issues.push('nodes: expected a non-empty root array');
  if (!Array.isArray(input.unsupportedRequests) || input.unsupportedRequests.length > 30) {
    issues.push('unsupportedRequests: expected an array with at most 30 items');
  } else input.unsupportedRequests.forEach((item, i) => {
    const p = `unsupportedRequests[${i}]`;
    if (!plainObject(item)) { issues.push(`${p}: expected object`); return; }
    ownKeysOnly(item, ['requirementId', 'capability', 'reason', 'severity'], p, issues);
    checkString(item.requirementId, `${p}.requirementId`, issues, { max: 80 });
    checkString(item.capability, `${p}.capability`, issues, { max: 240 });
    checkString(item.reason, `${p}.reason`, issues, { max: 600 });
    checkEnum(item.severity, new Set(['blocking', 'nonblocking']), `${p}.severity`, issues);
  });
  const ids = new Set();
  let count = 0;
  const visit = (node, path, depth) => {
    count++;
    if (count > limits.maxNodes) { issues.push(`nodes: exceeds maximum node count ${limits.maxNodes}`); return; }
    if (depth > limits.maxDepth) { issues.push(`${path}: exceeds maximum nesting depth ${limits.maxDepth}`); return; }
    if (!plainObject(node)) { issues.push(`${path}: expected plain object`); return; }
    const type = node.type;
    const knownBuiltin = isBuiltinPagePlanType(type);
    const extension = typeof type === 'string' ? getPagePlanRenderer(type) : null;
    if (!knownBuiltin && !extension) { issues.push(`${path}.type: unsupported renderer type`); return; }
    if (typeof node.id !== 'string' || !ID_RE.test(node.id)) issues.push(`${path}.id: invalid stable id`);
    else if (ids.has(node.id)) issues.push(`${path}.id: duplicate id "${node.id}"`);
    else ids.add(node.id);

    if (extension) {
      try {
        const result = extension.validate(node);
        if (result !== true) issues.push(`${path}: extension validator rejected node`);
      } catch (e) { issues.push(`${path}: extension validator error (${String(e?.message ?? e).slice(0, 120)})`); }
      return;
    }
    ownKeysOnly(node, PAGEPLAN_NODE_KEYS[type], path, issues);
    switch (type) {
      case 'section':
        for (const k of ['label', 'eyebrow', 'title', 'description']) checkString(node[k], `${path}.${k}`, issues, { required: k === 'title', max: k === 'description' ? 1600 : 300, allowEmpty: k === 'description' });
        checkEnum(node.variant ?? 'plain', SECTION_VARIANTS, `${path}.variant`, issues);
        visitChildren(node.children, `${path}.children`, depth, issues, visit, limits);
        break;
      case 'container':
        checkEnum(node.layout, CONTAINER_LAYOUTS, `${path}.layout`, issues);
        if (node.columns != null && ![2, 3, 4].includes(node.columns)) issues.push(`${path}.columns: expected 2, 3, or 4`);
        if (node.layout !== 'grid' && node.columns != null) issues.push(`${path}.columns is only valid for grid layout`);
        visitChildren(node.children, `${path}.children`, depth, issues, visit, limits);
        break;
      case 'heading':
        if (![1, 2, 3].includes(node.level)) issues.push(`${path}.level: expected 1, 2, or 3`);
        checkString(node.text, `${path}.text`, issues, { max: 260 });
        break;
      case 'text': checkString(node.text, `${path}.text`, issues, { max: limits.maxString }); break;
      case 'image':
        checkString(node.src, `${path}.src`, issues, { required: !String(node.searchQuery ?? '').trim(), max: 1000 });
        checkString(node.searchQuery, `${path}.searchQuery`, issues, { required: false, max: 240, allowEmpty: true });
        checkString(node.alt, `${path}.alt`, issues, { max: 300, allowEmpty: true });
        checkString(node.caption, `${path}.caption`, issues, { required: false, max: 500, allowEmpty: true });
        if (!String(node.src ?? '').trim() && !String(node.searchQuery ?? '').trim()) issues.push(`${path}: provide src or searchQuery`);
        if (typeof node.src === 'string' && node.src.trim() && !isSafeUrl(node.src, { image: true })) issues.push(`${path}.src: unsafe URL`);
        break;
      case 'link':
        checkString(node.label, `${path}.label`, issues, { max: 240 });
        checkString(node.href, `${path}.href`, issues, { max: 1000 });
        checkEnum(node.variant ?? 'quiet', LINK_VARIANTS, `${path}.variant`, issues);
        if (typeof node.href === 'string' && !isSafeUrl(node.href)) issues.push(`${path}.href: unsafe URL`);
        break;
      case 'card':
        checkString(node.eyebrow, `${path}.eyebrow`, issues, { required: false, max: 160, allowEmpty: true });
        checkString(node.title, `${path}.title`, issues, { max: 260 });
        checkString(node.description, `${path}.description`, issues, { required: false, max: 1200, allowEmpty: true });
        if (node.tags != null) {
          if (!Array.isArray(node.tags) || node.tags.length > 12 || node.tags.some((tag) => typeof tag !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(tag))) issues.push(`${path}.tags: expected up to 12 kebab-case tags`);
          else if (new Set(node.tags).size !== node.tags.length) issues.push(`${path}.tags: duplicate tags`);
        }
        if (node.children != null) visitChildren(node.children, `${path}.children`, depth, issues, visit, limits);
        break;
      case 'search':
      case 'filter':
        if (!validateInteractionNode(node)) issues.push(`${path}: invalid ${type} interaction node`);
        break;
      case 'tabs':
        if (!validateInteractionNode(node)) { issues.push(`${path}: invalid tabs interaction node`); break; }
        for (const panel of node.panels) {
          if (ids.has(panel.id)) issues.push(`${path}.panels: duplicate id "${panel.id}"`);
          else ids.add(panel.id);
          visitChildren(panel.children, `${path}.panels.${panel.id}.children`, depth, issues, visit, limits);
        }
        break;
      case 'list':
        if (!Array.isArray(node.items) || node.items.length === 0 || node.items.length > limits.maxItems) issues.push(`${path}.items: expected 1-${limits.maxItems} items`);
        else node.items.forEach((item, i) => {
          const ip = `${path}.items[${i}]`;
          if (!plainObject(item)) { issues.push(`${ip}: expected object`); return; }
          ownKeysOnly(item, ['title', 'text'], ip, issues);
          checkString(item.title, `${ip}.title`, issues, { required: false, max: 240, allowEmpty: true });
          checkString(item.text, `${ip}.text`, issues, { max: 1200 });
        });
        break;
      case 'details':
        checkString(node.summary, `${path}.summary`, issues, { max: 240 });
        visitChildren(node.children, `${path}.children`, depth, issues, visit, limits);
        break;
      case 'timeline':
        if (!Array.isArray(node.items) || node.items.length === 0 || node.items.length > limits.maxItems) issues.push(`${path}.items: expected 1-${limits.maxItems} items`);
        else node.items.forEach((item, i) => {
          const ip = `${path}.items[${i}]`;
          if (!plainObject(item)) { issues.push(`${ip}: expected object`); return; }
          ownKeysOnly(item, ['id', 'date', 'title', 'body'], ip, issues);
          if (typeof item.id !== 'string' || !ID_RE.test(item.id)) issues.push(`${ip}.id: invalid id`);
          checkString(item.date, `${ip}.date`, issues, { max: 80 });
          checkString(item.title, `${ip}.title`, issues, { max: 240 });
          checkString(item.body, `${ip}.body`, issues, { max: 1000 });
        });
        break;
      case 'metric':
        checkString(node.label, `${path}.label`, issues, { max: 180 });
        checkString(node.value, `${path}.value`, issues, { max: 180 });
        checkString(node.detail, `${path}.detail`, issues, { required: false, max: 400, allowEmpty: true });
        break;
      case 'callout':
        checkString(node.title, `${path}.title`, issues, { max: 200 });
        checkString(node.body, `${path}.body`, issues, { max: 1200 });
        checkEnum(node.tone ?? 'neutral', CALLOUT_TONES, `${path}.tone`, issues);
        break;
      case 'divider': break;
      case 'scene3d':
        if (!validateScene3DNode(node)) issues.push(`${path}: invalid scene3d configuration, object geometry, controls or bounds`);
        else {
          for (const object of node.objects) {
            if (ids.has(object.id)) issues.push(`${path}.objects: duplicate stable id \"${object.id}\"`);
            else ids.add(object.id);
          }
          count += node.objects.length;
          if (count > limits.maxNodes) issues.push(`nodes: exceeds maximum node count ${limits.maxNodes}`);
        }
        break;
      case 'quote':
        checkString(node.text, `${path}.text`, issues, { max: 1400 });
        checkString(node.byline, `${path}.byline`, issues, { required: false, max: 200, allowEmpty: true });
        break;
    }
  };

  if (Array.isArray(input.nodes)) input.nodes.forEach((node, i) => visit(node, `nodes[${i}]`, 1));
  if (Array.isArray(input.nodes)) validateInteractionRelationships(input.nodes, issues);
  if (issues.length) throw new PagePlanValidationError(issues);

  // Return a defensive copy; renderers must not mutate model-owned input.
  return structuredClone(input);
}

function validateInteractionRelationships(nodes, issues) {
  const byId = new Map();
  const flatten = (items) => {
    for (const node of items ?? []) {
      byId.set(node.id, node);
      if (Array.isArray(node.children)) flatten(node.children);
      if (node.type === 'tabs') for (const panel of node.panels ?? []) flatten(panel.children);
    }
  };
  flatten(nodes);
  for (const [id, node] of byId) {
    if (node.type !== 'search' && node.type !== 'filter') continue;
    const target = byId.get(node.targetId);
    if (!target || target.type !== 'container' || !Array.isArray(target.children) || target.children.length === 0 || target.children.some((child) => child.type !== 'card')) {
      issues.push(`${node.type} ${id}: targetId must reference a container containing only direct card children`);
      continue;
    }
    if (node.type === 'filter') {
      const availableTags = new Set(target.children.flatMap((card) => Array.isArray(card.tags) ? card.tags : []));
      for (const option of node.options ?? []) if (option.tag !== '*' && !availableTags.has(option.tag)) issues.push(`filter ${id}: option tag ${option.tag} does not exist on target cards`);
    }
  }
}

function visitChildren(children, path, depth, issues, visit, limits) {
  if (!Array.isArray(children) || children.length === 0 || children.length > limits.maxNodes) {
    issues.push(`${path}: expected a non-empty bounded array`); return;
  }
  children.forEach((child, i) => visit(child, `${path}[${i}]`, depth + 1));
}

export function isSafeUrl(raw, { image = false } = {}) {
  if (typeof raw !== 'string' || !raw || raw.length > 1000 || /[\u0000-\u0020\\]/.test(raw)) return false;
  if (raw.startsWith('#')) return /^#[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(raw);
  if (/^https:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      return parsed.protocol === 'https:' && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
    } catch { return false; }
  }
  if (!image && /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(raw)) return true;
  // Only simple relative/local paths are allowed; block protocol-relative and traversal paths.
  if (raw.startsWith('//') || raw.startsWith('\\') || /(^|\/)\.\.(\/|$)/.test(raw)) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return false;
  return /^(?:\.\/)?[A-Za-z0-9_./-]+(?:\?[A-Za-z0-9_=&%-]*)?(?:#[A-Za-z0-9_-]*)?$/.test(raw);
}
