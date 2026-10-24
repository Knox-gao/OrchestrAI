/**
 * PagePlan 草稿的确定性规范化（校验前的机械修复）。
 *
 * 为什么需要这一层：
 *   真实 deepseek 连续两轮 PAGEPLAN_INVALID，第二轮只剩一个错误 ——
 *   `timeline.items[0]: unsupported property "type"`。模型给时间线条目
 *   多写了一个 type 字段。这类偏差是纯机械噪声，不该消耗一整轮重试，
 *   更不该让整次生成失败。
 *
 * 边界（很重要）：
 *   - **只做可判定的机械修复**：删多余字段、去掉空 children、去掉非 grid
 *     容器的 columns、截断从不渲染的元数据、给重复 id 加后缀。
 *   - **绝不发明内容**：不补文案、不改语义、不填缺失的必填字段。
 *     缺 title、缺 items、结构缺失一律留给校验去拒。
 *   - **每一项修复都记录在案**，由上层写进事件日志，不静默发生。
 *   - 修复后仍然要跑**完整校验**，门槛一点没降。
 */

import { SCENE3D_CONTRACT } from './scene3d.mjs';
import { PAGEPLAN_ENUMS } from './schema.mjs';

const LIST_ITEM_KEYS = new Set(['title', 'text']);
const TIMELINE_ITEM_KEYS = new Set(['id', 'date', 'title', 'body']);

/** children 非空即必须的节点类型：空数组时整个节点都是废的，直接摘除。 */
const CHILDREN_REQUIRED = new Set(['section', 'container', 'details']);

const SECTION_VARIANTS = new Set(PAGEPLAN_ENUMS.sectionVariant);
const CONTAINER_LAYOUTS_SET = new Set(PAGEPLAN_ENUMS.containerLayout);
const ID_RE = /^[a-z][a-z0-9-]{0,49}$/;

function isObj(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

/** 只删白名单外的键，返回被删掉的键名。 */
function stripKeys(obj, allowed, path, repairs) {
  const removed = [];
  for (const key of Object.keys(obj)) {
    if (allowed.has(key)) continue;
    delete obj[key];
    removed.push(key);
  }
  if (removed.length) repairs.push({ path, action: 'strip-unknown-keys', keys: removed });
  return removed;
}

/** 把重复 id 改成 id-2 / id-3，避免整份计划因一个重复 id 全盘失败。 */
function dedupeIds(ids, id, path, repairs) {
  if (typeof id !== 'string' || !id) return id;
  if (!ids.has(id)) { ids.add(id); return id; }
  let n = 2;
  let next = `${id}-${n}`;
  while (ids.has(next)) { n += 1; next = `${id}-${n}`; }
  ids.add(next);
  repairs.push({ path, action: 'rename-duplicate-id', from: id, to: next });
  return next;
}

function visitNode(node, path, ids, repairs) {
  if (!isObj(node)) return node;
  if (typeof node.id === 'string') node.id = dedupeIds(ids, node.id, `${path}.id`, repairs);
  const type = node.type;

  // section.variant 被填了 container.layout 的值（实测 split）→ 回到缺省 plain。
  // 与"删掉该字段"等价，不改变渲染结果；只处理可判定的跨属性误用。
  if (type === 'section' && typeof node.variant === 'string') {
    if (!SECTION_VARIANTS.has(node.variant) && CONTAINER_LAYOUTS_SET.has(node.variant)) {
      repairs.push({ path: `${path}.variant`, action: 'map-layout-to-default-variant', from: node.variant, to: 'plain' });
      node.variant = 'plain';
    }
  }

  // container.layout 反向被填了 section.variant 的值（如 panel / contrast）→ 回到 stack。
  if (type === 'container' && typeof node.layout === 'string') {
    if (!CONTAINER_LAYOUTS_SET.has(node.layout) && SECTION_VARIANTS.has(node.layout)) {
      repairs.push({ path: `${path}.layout`, action: 'map-variant-to-default-layout', from: node.layout, to: 'stack' });
      node.layout = 'stack';
    }
  }

  if (type === 'list' && Array.isArray(node.items)) {
    node.items.forEach((item, i) => {
      if (isObj(item)) stripKeys(item, LIST_ITEM_KEYS, `${path}.items[${i}]`, repairs);
    });
  }

  if (type === 'timeline' && Array.isArray(node.items)) {
    node.items.forEach((item, i) => {
      if (!isObj(item)) return;
      stripKeys(item, TIMELINE_ITEM_KEYS, `${path}.items[${i}]`, repairs);
      if (typeof item.id === 'string') item.id = dedupeIds(ids, item.id, `${path}.items[${i}].id`, repairs);
    });
  }

  // columns 只在 grid 布局下合法：其他布局里它一定是模型误加的
  if (type === 'container' && node.layout !== 'grid' && node.columns != null) {
    delete node.columns;
    repairs.push({ path: `${path}.columns`, action: 'drop-columns-outside-grid' });
  }

  // tabs：删掉空面板；剩不足 2 个面板时整个 tabs 节点失去意义
  if (type === 'tabs' && Array.isArray(node.panels)) {
    const kept = node.panels.filter((panel, i) => {
      if (isObj(panel)) panel.children = visitChildren(panel.children, `${path}.panels[${i}].children`, ids, repairs, true);
      const empty = !isObj(panel) || !Array.isArray(panel.children) || panel.children.length === 0;
      if (empty) repairs.push({ path: `${path}.panels[${i}]`, action: 'drop-empty-tab-panel' });
      return !empty;
    });
    node.panels = kept;
    if (kept.length < 2) {
      repairs.push({ path, action: 'drop-tabs-with-too-few-panels' });
      return null;
    }
    if (kept.length && !kept.some((p) => p.id === node.initialTab)) {
      node.initialTab = kept[0].id;
      repairs.push({ path: `${path}.initialTab`, action: 'repoint-initial-tab', to: node.initialTab });
    }
  }

  if (type === 'scene3d') {
    // height：模型常写像素数字（480），映射到最近的合法枚举密度档
    if (!SCENE3D_CONTRACT.heights.includes(node.height)) {
      const numeric = Number(node.height);
      const mapped = Number.isFinite(numeric)
        ? (numeric <= 400 ? 'compact' : numeric >= 520 ? 'wide' : 'standard')
        : 'standard';
      repairs.push({ path: `${path}.height`, action: 'map-to-enum', from: node.height, to: mapped });
      node.height = mapped;
    }

    // controls：模型常写成数组 ["rotate","zoom"]，转成布尔对象
    if (Array.isArray(node.controls)) {
      const wanted = new Set(node.controls.map((v) => String(v).toLowerCase()));
      const mapped = {};
      for (const key of SCENE3D_CONTRACT.controlKeys) {
        // 常见的别名，只做等价映射，不擅自开启用户没提的能力
        // 别名只做字面等价：'rotate' 指的是用户拖拽旋转（orbit），
        // 不是自动旋转（autoRotate）—— 把两者混起来会擅自给页面加自转动画。
        const aliases = key === 'autoRotate' ? ['autorotate', 'autospin']
          : key === 'orbit' ? ['orbit', 'drag', 'rotate', 'rotation']
          : [key.toLowerCase()];
        mapped[key] = aliases.some((a) => wanted.has(a)) || wanted.has(key.toLowerCase());
      }
      repairs.push({ path: `${path}.controls`, action: 'array-to-object', from: node.controls, to: Object.keys(mapped).filter((k) => mapped[k]) });
      node.controls = mapped;
    } else if (isObj(node.controls)) {
      for (const key of Object.keys(node.controls)) {
        if (!SCENE3D_CONTRACT.controlKeys.includes(key)) {
          delete node.controls[key];
          repairs.push({ path: `${path}.controls.${key}`, action: 'drop-unknown-key' });
        }
      }
      for (const key of SCENE3D_CONTRACT.controlKeys) {
        if (typeof node.controls[key] !== 'boolean') {
          node.controls[key] = false;
          repairs.push({ path: `${path}.controls.${key}`, action: 'default-missing-boolean', to: false });
        }
      }
    }

    if (Array.isArray(node.objects)) {
      node.objects.forEach((object, i) => {
        if (!isObj(object)) return;
        // name 必须存在：用 id 兜底是可判定的等价物（渲染层本来就显示 name），
        // 不是发明新内容——id 是模型自己取的稳定标识。
        if (typeof object.name !== 'string' || !object.name.trim()) {
          object.name = typeof object.id === 'string' && object.id
            ? object.id.split('-').map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1)).join(' ')
            : `Object ${i + 1}`;
          repairs.push({ path: `${path}.objects[${i}].name`, action: 'derive-from-id', to: object.name });
        }
        if (typeof object.description !== 'string') {
          object.description = '';
          repairs.push({ path: `${path}.objects[${i}].description`, action: 'default-empty-string' });
        }
        if (object.motion === 'tide' && object.shape !== 'disk') {
          repairs.push({ path: `${path}.objects[${i}].motion`, action: 'drop-illegal-tide', from: object.motion });
          object.motion = 'none';
        }
      });
    }
  }

  // card.children 是可选的：空数组直接去掉键，保留卡片本身
  if (type === 'card' && Array.isArray(node.children) && node.children.length === 0) {
    delete node.children;
    repairs.push({ path: `${path}.children`, action: 'drop-empty-children-key' });
  }

  if (Array.isArray(node.children)) {
    node.children = visitChildren(node.children, `${path}.children`, ids, repairs, false);
    if (node.children.length === 0 && CHILDREN_REQUIRED.has(type)) {
      repairs.push({ path, action: 'drop-node-with-empty-children', type });
      return null;
    }
  } else if (CHILDREN_REQUIRED.has(type) && type !== 'card') {
    // 缺失 children（而不是空数组）属于结构性缺失，交给校验拒绝，不在这里补
  }

  return node;
}

function visitChildren(children, path, ids, repairs, insidePanel) {
  if (!Array.isArray(children)) return children;
  const out = [];
  children.forEach((child, i) => {
    const kept = visitNode(child, `${path}[${i}]`, ids, repairs);
    if (kept != null) out.push(kept);
  });
  return out;
}

/**
 * 规范化一份模型产出的 PagePlan 草稿。
 *
 * @param {object} draft 模型返回的原始对象（会被就地修改，调用方应先 clone）
 * @param {object} options.limits PAGEPLAN_LIMITS
 * @returns {{ draft: object, repairs: Array }}
 */
export function normalizePagePlanDraft(draft, { limits } = {}) {
  const repairs = [];
  if (!isObj(draft)) return { draft, repairs };

  const ids = new Set();
  if (Array.isArray(draft.nodes)) {
    draft.nodes = visitChildren(draft.nodes, 'nodes', ids, repairs, false);
    if (draft.nodes.length === 0) repairs.push({ path: 'nodes', action: 'all-nodes-dropped' });
  }

  // visualPrinciples 从不参与渲染，只是设计说明；截断不损失页面内容
  const principles = draft.designIntent?.visualPrinciples;
  if (Array.isArray(principles)) {
    const maxItems = limits?.maxVisualPrinciples ?? 12;
    const maxLen = limits?.maxVisualPrincipleLength ?? 220;
    if (principles.length > maxItems) {
      draft.designIntent.visualPrinciples = principles.slice(0, maxItems);
      repairs.push({ path: 'designIntent.visualPrinciples', action: 'truncate-items', from: principles.length, to: maxItems });
    }
    draft.designIntent.visualPrinciples = draft.designIntent.visualPrinciples.map((v, i) => {
      if (typeof v !== 'string') return v;
      if (v.length <= maxLen) return v;
      repairs.push({ path: `designIntent.visualPrinciples[${i}]`, action: 'truncate-string', from: v.length, to: maxLen });
      return v.slice(0, maxLen);
    });
  }

  // 卡片 tag 去重（只去重，不改写法：filter 的 tag 依赖这里的原值）
  if (Array.isArray(draft.nodes)) {
    const seenTags = [];
    const walkTags = (nodes, path) => {
      nodes.forEach((node, i) => {
        if (!isObj(node)) return;
        if (Array.isArray(node.tags)) {
          const uniq = [...new Set(node.tags)];
          if (uniq.length !== node.tags.length) {
            repairs.push({ path: `${path}[${i}].tags`, action: 'dedupe-tags' });
            node.tags = uniq;
          }
        }
        if (Array.isArray(node.children)) walkTags(node.children, `${path}[${i}].children`);
        if (Array.isArray(node.panels)) node.panels.forEach((p, j) => {
          if (isObj(p) && Array.isArray(p.children)) walkTags(p.children, `${path}[${i}].panels[${j}].children`);
        });
      });
    };
    walkTags(draft.nodes, 'nodes');
    void seenTags;
  }

  // 站内锚点解析：把 href="#x" 指到真实存在的节点 id。
  // 实测模型写 "#pricing" 而节点 id 是 "pricing-section"，只差一个后缀却阻断整次交付。
  const anchorRepairs = resolveFragmentAnchors(draft, repairs);
  void anchorRepairs;

  return { draft, repairs };
}


/**
 * 把所有 link 的 href="#x" 解析到真实存在的节点 id。
 *
 * 匹配顺序（只在**唯一命中**时才改写，避免歧义）：
 *   1. 完全相同
 *   2. x + "-section"（模型最常漏的后缀）
 *   3. 以 x + "-" 开头的唯一节点
 *   4. 以 "-" + x 结尾的唯一节点
 * 解析不了的**不改写**，留给上层校验报错（让重试循环去修）。
 */
function resolveFragmentAnchors(draft, repairs) {
  const ids = new Set();
  const collect = (nodes) => {
    for (const node of nodes ?? []) {
      if (isObj(node) && typeof node.id === 'string') ids.add(node.id);
      if (isObj(node)) {
        collect(node.children);
        for (const panel of node.panels ?? []) collect(panel?.children);
      }
    }
  };
  collect(draft.nodes);

  const pick = (fragment) => {
    if (ids.has(fragment)) return fragment;
    const suffixed = `${fragment}-section`;
    if (ids.has(suffixed)) return suffixed;
    const prefixed = [...ids].filter((id) => id.startsWith(`${fragment}-`));
    if (prefixed.length === 1) return prefixed[0];
    const tailed = [...ids].filter((id) => id.endsWith(`-${fragment}`));
    if (tailed.length === 1) return tailed[0];
    return null;
  };

  const walk = (nodes) => {
    for (const node of nodes ?? []) {
      if (!isObj(node)) continue;
      if (node.type === 'link' && typeof node.href === 'string' && node.href.startsWith('#') && node.href.length > 1) {
        const fragment = node.href.slice(1);
        const target = pick(fragment);
        if (target && target !== fragment) {
          node.href = `#${target}`;
          repairs.push({ path: `${node.id}.href`, action: 'resolve-fragment-anchor', from: `#${fragment}`, to: `#${target}` });
        }
      }
      walk(node.children);
      for (const panel of node.panels ?? []) walk(panel?.children);
    }
  };
  walk(draft.nodes);
}