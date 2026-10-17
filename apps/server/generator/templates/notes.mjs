/** 模板：速记本 —— 笔记 CRUD + 时间戳排序 */
import { buildThemeCss, pageShell } from '../theme.mjs';
import { getStyleDef } from '../styles.mjs';

export const meta = {
  type: 'notes',
  name: '速记本',
  keywords: ['笔记', '备忘', '速记', '记录', 'memo', 'note', '便签'],
  accent: '#9d4edd', accentRgb: '157,78,221',
  features: ['新增 / 编辑 / 删除笔记', '按更新时间排序（最新在前）', '字数统计', '空内容拦截'],
};

export function files(spec) {
  const logic = `export function createNotes() {
  return { notes: [] };
}

export function addNote(n, rawText) {
  const text = String(rawText ?? '').trim();
  if (!text) return { ok: false, reason: '内容不能为空' };
  const note = { id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, createdAt: Date.now(), updatedAt: Date.now() };
  n.notes.push(note);
  return { ok: true, note };
}

export function updateNote(n, id, rawText) {
  const note = n.notes.find((x) => x.id === id);
  if (!note) return { ok: false, reason: '笔记不存在' };
  const text = String(rawText ?? '').trim();
  if (!text) return { ok: false, reason: '内容不能为空' };
  note.text = text;
  note.updatedAt = Date.now();
  return { ok: true, note };
}

export function deleteNote(n, id) {
  const before = n.notes.length;
  n.notes = n.notes.filter((x) => x.id !== id);
  return { ok: n.notes.length === before - 1 };
}

/** 最新更新的排最前（缺陷检测点） */
export function sortedNotes(n) {
  return [...n.notes].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function stats(n) {
  const chars = n.notes.reduce((acc, x) => acc + x.text.length, 0);
  return { count: n.notes.length, chars };
}
`;

  const test = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotes, addNote, updateNote, deleteNote, sortedNotes, stats } from '../logic.mjs';

test('空内容不可新增', () => {
  const n = createNotes();
  assert.equal(addNote(n, '  ').ok, false);
});

test('新增与统计', () => {
  const n = createNotes();
  addNote(n, 'hello');
  addNote(n, '世界');
  assert.deepEqual(stats(n), { count: 2, chars: 7 });
});

test('排序：最新更新的在最前（缺陷检测点）', () => {
  const n = createNotes();
  const a = addNote(n, '第一条').note;
  const b = addNote(n, '第二条').note;
  a.updatedAt = 1000; b.updatedAt = 2000;
  assert.deepEqual(sortedNotes(n).map((x) => x.id), [b.id, a.id], 'updatedAt 大的排前面');
});

test('编辑笔记更新时间戳且保持 id', async () => {
  const n = createNotes();
  const { note } = addNote(n, '旧内容');
  await new Promise((r) => setTimeout(r, 5));
  const r = updateNote(n, note.id, '新内容');
  assert.equal(r.ok, true);
  assert.equal(r.note.id, note.id);
  assert.equal(r.note.text, '新内容');
  assert.ok(r.note.updatedAt >= note.updatedAt);
});

test('删除不存在的笔记返回失败', () => {
  const n = createNotes();
  assert.equal(deleteNote(n, 'nope').ok, false);
});
`;

  const app = `import { createNotes, addNote, updateNote, deleteNote, sortedNotes, stats } from './logic.mjs';

const KEY = 'notes-store-v1';
const store = createNotes();
try { store.notes = JSON.parse(localStorage.getItem(KEY) ?? '[]').slice(-200); } catch {}
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(store.notes.slice(-200))); } catch {} };
const listEl = document.getElementById('notes');
const inputEl = document.getElementById('input');
const statEl = document.getElementById('stat');

function render() {
  const notes = sortedNotes(store);
  const st = stats(store);
  statEl.textContent = \`\${st.count} 条笔记 · \${st.chars} 字\`;
  if (notes.length === 0) { listEl.innerHTML = '<div class="empty">记下第一个想法吧 ✍️</div>'; return; }
  listEl.innerHTML = '';
  for (const nt of notes) {
    const card = document.createElement('div');
    card.className = 'note';
    card.innerHTML = \`
      <div class="ntext"></div>
      <div class="nrow">
        <span class="ntime"></span>
        <span class="grow"></span>
        <button class="edit">编辑</button>
        <button class="del">删除</button>
      </div>\`;
    card.querySelector('.ntext').textContent = nt.text;
    card.querySelector('.ntime').textContent = new Date(nt.updatedAt).toLocaleString('zh-CN', { hour12: false });
    card.querySelector('.edit').addEventListener('click', () => {
      const next = prompt('编辑笔记', nt.text);
      if (next !== null) updateNote(store, nt.id, next);
      persist();
      render();
    });
    card.querySelector('.del').addEventListener('click', () => {
      if (confirm('删除这条笔记？')) { deleteNote(store, nt.id); persist(); render(); }
    });
    listEl.appendChild(card);
  }
}

document.getElementById('form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (addNote(store, inputEl.value).ok) { persist(); inputEl.value = ''; }
  render();
});
render();
`;

  const html = pageShell(
    `${spec.title}`,
    spec.subtitle,
    `<div class="card">
  <form id="form" class="row"><input id="input" class="grow" placeholder="记点什么…回车保存" autocomplete="off" /><button class="primary" type="submit">保存</button></form>
</div>
<div class="card">
  <div id="notes"></div>
  <div id="stat" style="margin-top:12px;color:var(--text-dim);font-size:13px"></div>
</div>`,
  );

  const css = buildThemeCss(getStyleDef(spec)) + `
.note { padding: 12px 6px; border-bottom: 1px dashed var(--border); }
.note:last-of-type { border-bottom: none; }
.ntext { font-size: 15px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
.nrow { display: flex; gap: 8px; margin-top: 8px; align-items: center; }
.ntime { color: var(--text-dim); font-size: 12px; }
.nrow button { font-size: 12px; padding: 3px 10px; }
.grow { flex: 1; }
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

export function defectVariant(f) {
  return {
    ...f,
    'logic.mjs': f['logic.mjs'].replace(
      'return [...n.notes].sort((a, b) => b.updatedAt - a.updatedAt);',
      'return [...n.notes].sort((a, b) => a.updatedAt - b.updatedAt); // [预设缺陷] 排序方向反了',
    ),
  };
}

export function fixedLogic(f) {
  return f['logic.mjs'];
}
