/** 模板：任务清单（todo）—— 增删改查 + 筛选 + localStorage 持久化 */
import { buildThemeCss, pageShell } from '../theme.mjs';
import { getStyleDef } from '../styles.mjs';

export const meta = {
  type: 'todo',
  name: '任务清单',
  keywords: ['任务', '待办', '清单', 'todo', '列表', '事项'],
  accent: '#00f5d4', accentRgb: '0,245,212',
  features: ['新增任务（回车提交，空标题拦截）', '点击切换完成状态', '全部 / 未完成 / 已完成 筛选', '删除任务', '刷新后数据保持（localStorage）'],
};

export function files(spec) {
  const logic = `const KEY = 'todo-items-v1';

export function createStore() {
  return { items: load(), filter: 'all' };
}

export const FILTERS = ['all', 'active', 'done'];

export function addItem(store, rawTitle) {
  const title = String(rawTitle ?? '').trim();
  if (!title) return { ok: false, reason: '标题不能为空' };
  const item = { id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title, done: false, createdAt: Date.now() };
  store.items.unshift(item);
  save(store);
  return { ok: true, item };
}

export function toggleItem(store, id) {
  const item = store.items.find((t) => t.id === id);
  if (!item) return { ok: false, reason: '任务不存在' };
  item.done = !item.done;
  save(store);
  return { ok: true, item };
}

export function removeItem(store, id) {
  const before = store.items.length;
  store.items = store.items.filter((t) => t.id !== id);
  save(store);
  return { ok: store.items.length === before - 1 };
}

export function visibleItems(store) {
  if (store.filter === 'active') return store.items.filter((t) => !t.done);
  if (store.filter === 'done') return store.items.filter((t) => t.done);
  return [...store.items];
}

export function counts(store) {
  const done = store.items.filter((t) => t.done).length;
  return { total: store.items.length, done, active: store.items.length - done };
}

function save(store) {
  try { localStorage.setItem(KEY, JSON.stringify(store.items)); } catch {}
}
function load() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}
`;

  const test = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, addItem, toggleItem, removeItem, visibleItems, counts } from '../logic.mjs';

test('空标题不可提交', () => {
  const s = createStore();
  const r = addItem(s, '   ');
  assert.equal(r.ok, false);
  assert.equal(counts(s).total, 0);
});

test('新增任务出现在列表顶部并回填标题', () => {
  const s = createStore();
  addItem(s, '写周报');
  const r2 = addItem(s, '买咖啡');
  assert.equal(s.items[0].id, r2.item.id);
  assert.equal(r2.item.title, '买咖啡');
});

test('切换完成状态（缺陷检测点）', () => {
  const s = createStore();
  const { item } = addItem(s, '复习单词');
  const r = toggleItem(s, item.id);
  assert.equal(r.ok, true);
  assert.equal(r.item.done, true, 'toggle 后 done 必须从 false 变为 true');
});

test('筛选与计数一致', () => {
  const s = createStore();
  const a = addItem(s, 'A').item;
  addItem(s, 'B');
  toggleItem(s, a.id);
  s.filter = 'done';
  assert.deepEqual(visibleItems(s).map((t) => t.title), ['A']);
  assert.deepEqual(counts(s), { total: 2, done: 1, active: 1 });
});

test('删除任务后计数减少', () => {
  const s = createStore();
  const { item } = addItem(s, '临时事项');
  const r = removeItem(s, item.id);
  assert.equal(r.ok, true);
  assert.equal(counts(s).total, 0);
});
`;

  const app = `import { createStore, addItem, toggleItem, removeItem, visibleItems, counts, FILTERS } from './logic.mjs';

const store = createStore();
const listEl = document.getElementById('list');
const inputEl = document.getElementById('input');
const countEl = document.getElementById('count');
const tabsEl = document.getElementById('filters');

function render() {
  const items = visibleItems(store);
  countEl.textContent = \`\${counts(store).done} / \${counts(store).total} 已完成\`;
  tabsEl.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('primary', b.dataset.f === store.filter);
  });
  if (items.length === 0) {
    listEl.innerHTML = '<div class="empty">还没有任务，从输入框开始吧 ✨</div>';
    return;
  }
  listEl.innerHTML = '';
  for (const t of items) {
    const row = document.createElement('div');
    row.className = 'item' + (t.done ? ' done' : '');
    row.innerHTML = \`
      <label class="check"><input type="checkbox" \${t.done ? 'checked' : ''} /><span></span></label>
      <span class="title"></span>
      <button class="del" title="删除">✕</button>\`;
    row.querySelector('.title').textContent = t.title;
    row.querySelector('input').addEventListener('change', () => { toggleItem(store, t.id); render(); });
    row.querySelector('.del').addEventListener('click', () => { removeItem(store, t.id); render(); });
    listEl.appendChild(row);
  }
}

document.getElementById('form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (addItem(store, inputEl.value).ok) inputEl.value = '';
  inputEl.focus();
  render();
});
tabsEl.innerHTML = '';
for (const f of FILTERS) {
  const label = { all: '全部', active: '未完成', done: '已完成' }[f];
  const b = document.createElement('button');
  b.textContent = label;
  b.dataset.f = f;
  b.addEventListener('click', () => { store.filter = f; render(); });
  tabsEl.appendChild(b);
}
render();
`;

  const html = pageShell(
    `${spec.title}`,
    spec.subtitle,
    `<div class="card">
  <form id="form" class="row"><input id="input" class="grow" placeholder="要做点什么？回车添加" autocomplete="off" /><button class="primary" type="submit">添加</button></form>
</div>
<div class="card">
  <div class="row" id="filters" style="margin-bottom:12px"></div>
  <div id="list"></div>
  <div class="stat" id="count" style="margin-top:12px;color:var(--text-dim);font-size:13px"></div>
</div>`,
  );

  const css = buildThemeCss(getStyleDef(spec)) + `
.item { display: flex; align-items: center; gap: 12px; padding: 11px 8px; border-bottom: 1px dashed var(--border); }
.item:last-child { border-bottom: none; }
.item .title { flex: 1; font-size: 15px; }
.item.done .title { color: var(--text-dim); text-decoration: line-through; }
.item .del { border: none; background: none; color: var(--text-dim); font-size: 13px; padding: 4px 8px; }
.item .del:hover { color: #ff5470; }
.check input { display: none; }
.check span { display: inline-block; width: 20px; height: 20px; border: 2px solid var(--border); border-radius: 6px; cursor: pointer; position: relative; }
.check input:checked + span { border-color: var(--accent); background: rgba(var(--accent-rgb), .2); }
.check input:checked + span::after { content: '✓'; color: var(--accent); position: absolute; inset: 0; display: grid; place-items: center; font-size: 13px; }
`;

  return {
    'index.html': html,
    'style.css': css,
    'app.mjs': app,
    'logic.mjs': logic,
    'test/logic.test.mjs': test,
    'package.json': JSON.stringify({ name: `app-${spec.type}`, private: true, type: 'module' }, null, 2),
  };
}

/** 缺陷变体：toggle 变成空操作（不改变 done），测试会真实失败 */
export function defectVariant(f) {
  return {
    ...f,
    'logic.mjs': f['logic.mjs'].replace(
      'item.done = !item.done;',
      'item.done = item.done; // [预设缺陷] 状态取反丢失',
    ),
  };
}

/** 修复：还原正确逻辑（用于缺陷退回后的重写） */
export function fixedLogic(f) {
  return f['logic.mjs'];
}
