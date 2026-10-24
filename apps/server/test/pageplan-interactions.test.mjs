import test from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validatePagePlan, PagePlanValidationError } from '../generator/pageplan/schema.mjs';
import { renderPagePlan } from '../generator/pageplan/render.mjs';
import { INTERACTION_RUNTIME, validateInteractionNode } from '../generator/pageplan/interactions.mjs';

function decodeCsp(html) {
  return html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/i)[1]
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

const base = JSON.parse(await readFile(new URL('../../../examples/island-pageplan.json', import.meta.url), 'utf8'));
function makeInteractionPlan() {
  const plan = structuredClone(base);
  plan.nodes = plan.nodes.filter((node) => node.type !== 'scene3d');
  // Avoid implying that the non-installed 3D capability is present in this interaction-only fixture.
  plan.nodes.push(
    { id: 'island-search', type: 'search', targetId: 'island-cards', label: '搜索岛屿档案', placeholder: '输入灯塔、植物或动物' },
    { id: 'island-filter', type: 'filter', targetId: 'island-cards', label: '按类别筛选', options: [{ tag: 'flora', label: '植物' }, { tag: 'fauna', label: '动物' }] },
    { id: 'island-cards', type: 'container', layout: 'grid', columns: 2, children: [
      { id: 'card-flora', type: 'card', title: '荧光植物', description: '夜间发出柔和蓝光。', tags: ['flora'] },
      { id: 'card-fauna', type: 'card', title: '果冻鲸', description: '沿外海缓慢游动的虚构动物。', tags: ['fauna'] },
    ] },
    { id: 'island-tabs', type: 'tabs', label: '岛屿资料', initialTab: 'tab-overview', panels: [
      { id: 'tab-overview', label: '概览', children: [{ id: 'tab-overview-title', type: 'heading', level: 2, text: '岛屿概览' }, { id: 'tab-overview-text', type: 'text', text: '从海岸线开始探索。' }] },
      { id: 'tab-lore', label: '传说', children: [{ id: 'tab-lore-title', type: 'heading', level: 2, text: '灯塔传说' }, { id: 'tab-lore-text', type: 'text', text: '这是虚构的岛屿传说。' }] },
    ] },
  );
  plan.designIntent.pageDirection = plan.userConstraints.pageDirection;
  return plan;
}

test('search/filter/tabs are validated as constrained declarative interactions', () => {
  const plan = makeInteractionPlan();
  assert.doesNotThrow(() => validatePagePlan(plan));
  assert.equal(validateInteractionNode(plan.nodes.find((n) => n.type === 'search')), true);
  assert.equal(validateInteractionNode(plan.nodes.find((n) => n.type === 'filter')), true);
  assert.equal(validateInteractionNode(plan.nodes.find((n) => n.type === 'tabs')), true);
});

test('rendered interactions use labels, result status, tags, ARIA tabs, and one CSP-pinned inline runtime', () => {
  const result = renderPagePlan(makeInteractionPlan());
  const html = result.files['index.html'];
  // 方案变更（实测驱动）：file:// 下带 crossorigin 的外部脚本会被 CORS 拦死（ERR_FAILED），
  // 因此 runtime 改为内联 + CSP sha256 精确白名单。强度不低于 SRI：脚本字节一变浏览器就不执行。
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 1, 'exactly one inline runtime script block');
  assert.equal(scripts[0][1].trim(), '', 'runtime script must have no attributes (no src)');
  const runtime = scripts[0][2];
  assert.ok(runtime.length > 100);
  const hash = 'sha256-' + createHash('sha256').update(runtime, 'utf8').digest('base64');
  const csp = decodeCsp(html);
  assert.ok(csp.includes("script-src '" + hash + "'"), 'CSP must pin the exact runtime hash');
  assert.match(html, /<label for="island-search-input"><span>搜索岛屿档案<\/span><\/label>/);
  assert.match(html, /data-pp-search-target="island-cards"/);
  assert.match(html, /data-pp-filter-target="island-cards"/);
  assert.match(html, /data-pp-collection-status aria-live="polite"/);
  assert.match(html, /data-pp-item[^>]*data-pp-tags="flora"/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /aria-controls="island-tabs-panel-tab-overview"/);
  assert.match(html, /id="island-tabs-panel-tab-lore"[^>]* hidden/);
  assert.match(runtime, /ArrowRight/);
  assert.match(runtime, /ArrowLeft/);
  assert.match(runtime, /event\.key === 'Home'/);
  assert.match(runtime, /closest\('\[data-pp-tabs\]'\) === root/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-eval/);
  assert.match(csp, /object-src 'none'/);
  assert.doesNotThrow(() => new Script(runtime));
  // report 结构：本仓库在候选基础上加了 autoFrame / cspHash / trustedRuntime 三个审计字段
  const features = result.report.features;
  assert.equal(features.interactions, 3, '三个交互节点都被统计');
  assert.equal(features.trustedRuntime, true);
  assert.equal(features.scene3d.scenes, 0, '无 3D 节点时 scenes 应为 0');
  assert.equal(features.scene3d.autoFrame, false);
  assert.match(features.scene3d.cspHash, /^sha256-/);
});

test('search/filter reject unknown targets, arbitrary selectors and tags absent from target cards', () => {
  const unknownTarget = makeInteractionPlan();
  unknownTarget.nodes.find((n) => n.type === 'search').targetId = 'missing-container';
  assert.throws(() => validatePagePlan(unknownTarget), /targetId must reference a container/);

  const missingTag = makeInteractionPlan();
  missingTag.nodes.find((n) => n.type === 'filter').options[0].tag = 'not-in-cards';
  assert.throws(() => validatePagePlan(missingTag), /does not exist on target cards/);

  const selectorInjection = makeInteractionPlan();
  selectorInjection.nodes.find((n) => n.type === 'filter').targetId = 'body';
  assert.throws(() => validatePagePlan(selectorInjection), PagePlanValidationError);
});

test('tabs reject duplicate panel IDs, unsafe properties and missing initial panel', () => {
  const duplicate = makeInteractionPlan();
  duplicate.nodes.find((n) => n.type === 'tabs').panels[1].id = 'tab-overview';
  assert.throws(() => validatePagePlan(duplicate), /duplicate id/);

  const badInitial = makeInteractionPlan();
  badInitial.nodes.find((n) => n.type === 'tabs').initialTab = 'does-not-exist';
  assert.throws(() => validatePagePlan(badInitial), /invalid tabs interaction node/);

  const arbitrary = makeInteractionPlan();
  arbitrary.nodes.find((n) => n.type === 'tabs').panels[0].children[1].onClick = 'alert(1)';
  assert.throws(() => validatePagePlan(arbitrary), /unsupported property/);
});

test('interaction runtime is CSP-pinned trusted source, and model text remains escaped', () => {
  const plan = makeInteractionPlan();
  plan.nodes.find((n) => n.type === 'tabs').panels[0].children[1].text = '<img src=x onerror=alert(1)>';
  const result = renderPagePlan(plan);
  const html = result.files['index.html'];
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x onerror=/i);
  const csp = decodeCsp(html);
  assert.match(csp, /script-src 'sha256-[A-Za-z0-9+/=]+'/);
  const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src'));
  assert.ok(scriptSrc, 'script-src must exist');
  assert.ok(!/unsafe-eval/.test(scriptSrc), 'script-src must not allow unsafe-eval');
  assert.ok(!/unsafe-inline/.test(scriptSrc), 'script-src must not allow unsafe-inline');
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.match(csp, /object-src 'none'/);
  const inline = html.match(/<script>([\s\S]*?)<\/script>/i)[1];
  assert.match(inline, /updateCollection/);
  assert.equal(INTERACTION_RUNTIME.length > 100, true);
});

test('interaction runtime changes search/filter visibility and activates tabs with keyboard input', async () => {
  const { runInNewContext } = await import('node:vm');
  class FakeElement {
    constructor(attrs = {}) {
      this.attrs = { ...attrs }; this.handlers = {}; this.hidden = false; this.value = attrs.value ?? ''; this.textContent = ''; this.tabIndex = Number(attrs.tabindex ?? -1); this.focused = false; this.queryMap = new Map(); this.closestMap = new Map();
      // runtime 会对状态元素调用 classList.toggle(...)。mock 必须提供，
      // 否则 status 元素存在时会抛 TypeError（这是 mock 缺口，不是 runtime 缺陷）。
      this.classList = {
        _set: new Set(),
        toggle(name, force) { const on = force === undefined ? !this._set.has(name) : !!force; if (on) this._set.add(name); else this._set.delete(name); return on; },
        contains(name) { return this._set.has(name); },
        add(name) { this._set.add(name); },
        remove(name) { this._set.delete(name); },
      };
    }
    addEventListener(type, fn) { this.handlers[type] = fn; }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    getAttribute(name) { return this.attrs[name] ?? null; }
    hasAttribute(name) { return Object.hasOwn(this.attrs, name); }
    querySelector(selector) { return this.queryMap.get(selector) ?? null; }
    querySelectorAll(selector) { return this.queryMap.get(selector) ?? []; }
    closest(selector) { return this.closestMap.get(selector) ?? null; }
    focus() { this.focused = true; }
    fire(type, extra = {}) { const handler = this.handlers[type]; assert.equal(typeof handler, 'function', `no ${type} listener registered`); handler({ currentTarget: this, key: extra.key, preventDefault: () => { extra.defaultPrevented = true; } }); return extra; }
  }
  const cardFlora = new FakeElement({ 'data-pp-search-text': '荧光植物 夜间蓝光', 'data-pp-tags': 'flora' });
  const cardFauna = new FakeElement({ 'data-pp-search-text': '果冻鲸 外海游动', 'data-pp-tags': 'fauna' });
  const status = new FakeElement();
  const collection = new FakeElement({ 'data-pp-collection': '' });
  collection.queryMap.set(':scope > [data-pp-item]', [cardFlora, cardFauna]);
  collection.queryMap.set(':scope > [data-pp-collection-status]', status);
  const search = new FakeElement({ 'data-pp-search-target': 'island-cards' });
  const filterGroup = new FakeElement();
  const allButton = new FakeElement({ 'data-pp-filter-target': 'island-cards', 'data-pp-filter-tag': '*', 'aria-pressed': 'true' });
  const floraButton = new FakeElement({ 'data-pp-filter-target': 'island-cards', 'data-pp-filter-tag': 'flora', 'aria-pressed': 'false' });
  allButton.closestMap.set('.pp-filter', filterGroup); floraButton.closestMap.set('.pp-filter', filterGroup);
  filterGroup.queryMap.set('[data-pp-filter-target]', [allButton, floraButton]);

  const tabsRoot = new FakeElement({ 'data-pp-tabs': '' });
  const overviewButton = new FakeElement({ 'data-pp-tab-button': 'overview', 'aria-selected': 'true', tabindex: '0' });
  const loreButton = new FakeElement({ 'data-pp-tab-button': 'lore', 'aria-selected': 'false', tabindex: '-1' });
  const overviewPanel = new FakeElement({ 'data-pp-tab-panel': 'overview' });
  const lorePanel = new FakeElement({ 'data-pp-tab-panel': 'lore' }); lorePanel.hidden = true;
  for (const element of [overviewButton, loreButton, overviewPanel, lorePanel]) element.closestMap.set('[data-pp-tabs]', tabsRoot);
  tabsRoot.queryMap.set('[data-pp-tab-button]', [overviewButton, loreButton]);
  tabsRoot.queryMap.set('[data-pp-tab-panel]', [overviewPanel, lorePanel]);
  const document = {
    getElementById(id) { return id === 'island-cards' ? collection : null; },
    querySelectorAll(selector) {
      if (selector === '[data-pp-search-target]') return [search];
      if (selector === '[data-pp-filter-target]') return [allButton, floraButton];
      if (selector === '[data-pp-tabs]') return [tabsRoot];
      return [];
    },
  };
  runInNewContext(INTERACTION_RUNTIME, { document });
  assert.equal(status.textContent, '找到 2 项');
  search.value = '鲸'; search.fire('input');
  assert.equal(cardFlora.hidden, true); assert.equal(cardFauna.hidden, false); assert.equal(status.textContent, '找到 1 项');
  search.value = ''; search.fire('input');
  floraButton.fire('click');
  assert.equal(floraButton.getAttribute('aria-pressed'), 'true'); assert.equal(allButton.getAttribute('aria-pressed'), 'false');
  assert.equal(cardFlora.hidden, false); assert.equal(cardFauna.hidden, true); assert.equal(status.textContent, '找到 1 项');
  loreButton.fire('click');
  assert.equal(loreButton.getAttribute('aria-selected'), 'true'); assert.equal(lorePanel.hidden, false); assert.equal(overviewPanel.hidden, true);
  const key = overviewButton.fire('keydown', { key: 'ArrowRight' });
  assert.equal(key.defaultPrevented, true); assert.equal(loreButton.focused, true); assert.equal(loreButton.getAttribute('aria-selected'), 'true');
});
