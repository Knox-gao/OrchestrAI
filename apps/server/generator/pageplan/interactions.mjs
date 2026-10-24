const ID_RE = /^[a-z][a-z0-9-]{0,49}$/;
const TAG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function validateInteractionNode(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'search') {
    return ID_RE.test(node.id ?? '') && ID_RE.test(node.targetId ?? '') &&
      typeof node.label === 'string' && node.label.trim().length > 0 && node.label.length <= 120 &&
      typeof node.placeholder === 'string' && node.placeholder.length <= 180;
  }
  if (node.type === 'filter') {
    return ID_RE.test(node.id ?? '') && ID_RE.test(node.targetId ?? '') &&
      typeof node.label === 'string' && node.label.trim().length > 0 && node.label.length <= 120 &&
      Array.isArray(node.options) && node.options.length >= 1 && node.options.length <= 12 &&
      node.options.every((option) => option && typeof option === 'object' &&
        Object.keys(option).every((key) => ['tag', 'label'].includes(key)) &&
        TAG_RE.test(option.tag ?? '') && typeof option.label === 'string' && option.label.trim().length > 0 && option.label.length <= 120);
  }
  if (node.type === 'tabs') {
    return ID_RE.test(node.id ?? '') && typeof node.label === 'string' && node.label.trim().length > 0 && node.label.length <= 120 &&
      Array.isArray(node.panels) && node.panels.length >= 2 && node.panels.length <= 8 &&
      node.panels.every((panel) => panel && typeof panel === 'object' &&
        Object.keys(panel).every((key) => ['id', 'label', 'children'].includes(key)) &&
        ID_RE.test(panel.id ?? '') && typeof panel.label === 'string' && panel.label.trim().length > 0 && panel.label.length <= 120 &&
        Array.isArray(panel.children) && panel.children.length > 0) &&
      typeof node.initialTab === 'string' && node.panels.some((panel) => panel.id === node.initialTab);
  }
  return false;
}

export function renderSearchNode(node) {
  if (!validateInteractionNode(node) || node.type !== 'search') throw new TypeError('invalid PagePlan search node');
  return `<div id="${esc(node.id)}" class="pp-search"><label for="${esc(node.id)}-input"><span>${esc(node.label)}</span></label><input id="${esc(node.id)}-input" type="search" data-pp-search-target="${esc(node.targetId)}" aria-controls="${esc(node.targetId)}" placeholder="${esc(node.placeholder)}" autocomplete="off"></div>`;
}

export function renderFilterNode(node) {
  if (!validateInteractionNode(node) || node.type !== 'filter') throw new TypeError('invalid PagePlan filter node');
  const buttons = [{ tag: '*', label: '全部' }, ...node.options].map((option, index) =>
    `<button type="button" class="pp-filter-option" data-pp-filter-target="${esc(node.targetId)}" data-pp-filter-tag="${esc(option.tag)}" aria-controls="${esc(node.targetId)}" aria-pressed="${index === 0 ? 'true' : 'false'}">${esc(option.label)}</button>`).join('');
  return `<div id="${esc(node.id)}" class="pp-filter" role="group" aria-label="${esc(node.label)}">${buttons}</div>`;
}

export function renderTabsNode(node, renderChildren) {
  if (!validateInteractionNode(node) || node.type !== 'tabs' || typeof renderChildren !== 'function') throw new TypeError('invalid PagePlan tabs node');
  const buttons = node.panels.map((panel) => `<button type="button" role="tab" id="${esc(node.id)}-tab-${esc(panel.id)}" data-pp-tab-button="${esc(panel.id)}" aria-controls="${esc(node.id)}-panel-${esc(panel.id)}" aria-selected="${panel.id === node.initialTab ? 'true' : 'false'}" tabindex="${panel.id === node.initialTab ? '0' : '-1'}">${esc(panel.label)}</button>`).join('');
  const panels = node.panels.map((panel) => `<section role="tabpanel" id="${esc(node.id)}-panel-${esc(panel.id)}" data-pp-tab-panel="${esc(panel.id)}" aria-labelledby="${esc(node.id)}-tab-${esc(panel.id)}"${panel.id === node.initialTab ? '' : ' hidden'}>${renderChildren(panel.children)}</section>`).join('');
  return `<div id="${esc(node.id)}" class="pp-tabs" data-pp-tabs role="group" aria-label="${esc(node.label)}"><div role="tablist" aria-label="${esc(node.label)}">${buttons}</div>${panels}</div>`;
}

function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch])); }

function interactionRuntimeMain() {
  'use strict';
  const collections = new Map();
  const getCollection = (id) => {
    const container = document.getElementById(id);
    if (!container || !container.hasAttribute('data-pp-collection')) return null;
    let state = collections.get(container);
    if (!state) {
      const items = Array.from(container.querySelectorAll(':scope > [data-pp-item]'));
      const status = container.querySelector(':scope > [data-pp-collection-status]');
      state = { container, items, status, query: '', tag: '*' };
      collections.set(container, state);
    }
    return state;
  };
  const updateCollection = (state) => {
    let visible = 0;
    for (const item of state.items) {
      const text = (item.getAttribute('data-pp-search-text') || '').toLocaleLowerCase();
      const tags = (item.getAttribute('data-pp-tags') || '').split(/\s+/).filter(Boolean);
      const match = text.includes(state.query) && (state.tag === '*' || tags.includes(state.tag));
      item.hidden = !match;
      if (match) visible++;
    }
    if (state.status) {
      state.status.textContent = visible === 0
        ? '没有找到匹配项目，请调整关键词或分类。'
        : `找到 ${visible} 项`;
      state.status.classList.toggle('is-empty', visible === 0);
    }
  };
  document.querySelectorAll('[data-pp-search-target]').forEach((input) => {
    const state = getCollection(input.getAttribute('data-pp-search-target'));
    if (!state) { input.disabled = true; return; }
    input.addEventListener('input', () => {
      state.query = input.value.trim().toLocaleLowerCase();
      updateCollection(state);
    });
  });
  document.querySelectorAll('[data-pp-filter-target]').forEach((button) => {
    const state = getCollection(button.getAttribute('data-pp-filter-target'));
    if (!state) { button.disabled = true; return; }
    button.addEventListener('click', () => {
      const owner = button.closest('.pp-filter');
      if (owner) owner.querySelectorAll('[data-pp-filter-target]').forEach((sibling) => {
        sibling.setAttribute('aria-pressed', String(sibling === button));
      });
      state.tag = button.getAttribute('data-pp-filter-tag') || '*';
      updateCollection(state);
    });
  });
  const ownTabChildren = (root, selector) => Array.from(root.querySelectorAll(selector)).filter((el) => el.closest('[data-pp-tabs]') === root);
  for (const state of collections.values()) updateCollection(state);
  const activate = (root, panelId, focus) => {
    const buttons = ownTabChildren(root, '[data-pp-tab-button]');
    const panels = ownTabChildren(root, '[data-pp-tab-panel]');
    const selected = buttons.find((button) => button.getAttribute('data-pp-tab-button') === panelId);
    if (!selected) return;
    for (const button of buttons) {
      const active = button === selected;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    }
    for (const panel of panels) panel.hidden = panel.getAttribute('data-pp-tab-panel') !== panelId;
    if (focus) selected.focus();
  };
  document.querySelectorAll('[data-pp-tabs]').forEach((root) => {
    const buttons = ownTabChildren(root, '[data-pp-tab-button]');
    if (!buttons.length) return;
    buttons.forEach((button, index) => {
      button.addEventListener('click', () => activate(root, button.getAttribute('data-pp-tab-button'), false));
      button.addEventListener('keydown', (event) => {
        let next = index;
        if (event.key === 'ArrowRight') next = (index + 1) % buttons.length;
        else if (event.key === 'ArrowLeft') next = (index - 1 + buttons.length) % buttons.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = buttons.length - 1;
        else return;
        event.preventDefault();
        activate(root, buttons[next].getAttribute('data-pp-tab-button'), true);
      });
    });
    const current = buttons.find((button) => button.getAttribute('aria-selected') === 'true') || buttons[0];
    activate(root, current.getAttribute('data-pp-tab-button'), false);
  });
}

export const INTERACTION_RUNTIME = `(${interactionRuntimeMain.toString()})();`;
