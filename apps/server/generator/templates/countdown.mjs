/** 模板：倒数日 —— 多事件倒数（生日/纪念日/截止）+ 大数字聚焦 + 持久化 */
import { buildThemeCss, pageShell } from '../theme.mjs';
import { getStyleDef } from '../styles.mjs';

export const meta = {
  type: 'countdown',
  name: '倒数日',
  keywords: ['倒数日', '倒计时', '生日', '纪念日', '倒数', '周年', '截止', 'calendar', 'countdown'],
  accent: '#4cc9f0', accentRgb: '76,201,240',
  features: ['多事件管理（名称 + 目标日期）', '大数字显示剩余天数', '最近事件自动置顶', '过期事件标记"已到达"', '刷新后数据保持'],
};

const DAY = 86_400_000;

export function files(spec) {
  const logic = `const DAY = 86400000;

/** 'YYYY-MM-DD' → 本地当天 00:00 的时间戳；非法返回 null */
export function normalizeDate(raw) {
  const m = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(String(raw ?? '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return null;
  return d.getTime();
}

export function createBoard() {
  return { events: [] };
}

export function addEvent(board, rawName, rawDate) {
  const name = String(rawName ?? '').trim();
  if (!name) return { ok: false, reason: '名称不能为空' };
  const date = normalizeDate(rawDate);
  if (date === null) return { ok: false, reason: '日期格式应为 YYYY-MM-DD' };
  const ev = { id: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, date, createdAt: Date.now() };
  board.events.push(ev);
  return { ok: true, event: ev };
}

export function removeEvent(board, id) {
  const before = board.events.length;
  board.events = board.events.filter((e) => e.id !== id);
  return { ok: board.events.length === before - 1 };
}

/** 最近_event 排在前：未过的按日期升序，已过的垫底（也按日期升序） */
export function sortedEvents(board, now = Date.now()) {
  const d = new Date(now);
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const upcoming = board.events.filter((e) => e.date >= today).sort((a, b) => a.date - b.date);
  const past = board.events.filter((e) => e.date < today).sort((a, b) => a.date - b.date);
  return [...upcoming, ...past];
}

/** 剩余自然日（按本地日历日差；缺陷检测点：明天必须是 1 天）。不能用 UTC 天取整——时区会差一天 */
export function daysUntil(ts, now = Date.now()) {
  const a = new Date(ts);
  const b = new Date(now);
  const dayA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const dayB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((dayA - dayB) / DAY);
}

export function remaining(ts, now = Date.now()) {
  const diff = ts - now;
  const passed = diff < 0;
  const abs = Math.abs(diff);
  return {
    passed,
    days: Math.floor(abs / DAY),
    hours: Math.floor((abs % DAY) / 3600000),
    minutes: Math.floor((abs % 3600000) / 60000),
  };
}

export function headline(ev, now = Date.now()) {
  const d = daysUntil(ev.date, now);
  if (d < 0) return { text: \`已到达 \${-d} 天\`, passed: true };
  if (d === 0) return { text: '就是今天！', passed: false };
  return { text: \`还有 \${d} 天\`, passed: false };
}
`;

  const test = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoard, addEvent, removeEvent, sortedEvents, daysUntil, remaining, headline, normalizeDate } from '../logic.mjs';

const DAY = 86400000;
const noon = (offsetDays) => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime() + offsetDays * DAY; };
const ymd = (ts) => { const d = new Date(ts); const p = (n) => String(n).padStart(2, '0'); return \`\${d.getFullYear()}-\${p(d.getMonth() + 1)}-\${p(d.getDate())}\`; };

test('非法输入被拒绝', () => {
  const b = createBoard();
  assert.equal(addEvent(b, '', '2030-01-01').ok, false);
  assert.equal(addEvent(b, '生日', '2030/01/01').ok, false);
  assert.equal(addEvent(b, '生日', '2030-13-40').ok, false);
  assert.equal(normalizeDate('abc'), null);
});

test('添加事件并计算剩余天数（缺陷检测点）', () => {
  const b = createBoard();
  const r = addEvent(b, '生日', ymd(noon(3)));
  assert.equal(r.ok, true);
  assert.equal(daysUntil(r.event.date, noon(0)), 3, '三天后的日期距今天必须是 3 天');
  assert.equal(daysUntil(r.event.date, noon(2)), 1);
});

test('今天与已过事件', () => {
  const b = createBoard();
  const { event } = addEvent(b, '答辩', ymd(noon(0)));
  assert.equal(daysUntil(event.date, noon(0)), 0);
  assert.equal(headline(event, noon(0)).text, '就是今天！');
  const past = addEvent(b, '旧事', ymd(noon(-2))).event;
  assert.equal(headline(past, noon(0)).passed, true);
  assert.equal(headline(past, noon(0)).text, '已到达 2 天');
});

test('排序：未过升序在前，已过垫底', () => {
  const b = createBoard();
  addEvent(b, '远', ymd(noon(10)));
  addEvent(b, '近', ymd(noon(1)));
  addEvent(b, '过', ymd(noon(-1)));
  assert.deepEqual(sortedEvents(b, noon(0)).map((e) => e.name), ['近', '远', '过']);
});

test('删除事件', () => {
  const b = createBoard();
  const { event } = addEvent(b, '临时', ymd(noon(1)));
  assert.equal(removeEvent(b, event.id).ok, true);
  assert.equal(removeEvent(b, event.id).ok, false);
});

test('remaining 时分秒拆解', () => {
  const target = noon(0) + 26 * 3600000 + 5 * 60000;
  const r = remaining(target, noon(0));
  assert.deepEqual({ days: r.days, hours: r.hours, minutes: r.minutes }, { days: 1, hours: 2, minutes: 5 });
});
`;

  const app = `import { createBoard, addEvent, removeEvent, sortedEvents, headline } from './logic.mjs';

const KEY = 'countdown-events-v1';
const board = createBoard();
try { board.events = JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch {}
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(board.events)); } catch {} };

const listEl = document.getElementById('list');
const nameEl = document.getElementById('name');
const dateEl = document.getElementById('date');

function render() {
  const events = sortedEvents(board);
  if (events.length === 0) {
    listEl.innerHTML = '<div class="empty">添加第一个倒数日吧 — 生日、纪念日、截止日期…</div>';
    return;
  }
  listEl.innerHTML = '';
  for (const ev of events) {
    const h = headline(ev);
    const row = document.createElement('div');
    row.className = 'ev' + (h.passed ? ' passed' : '') + (h.text === '就是今天！' ? ' today' : '');
    row.innerHTML = '<div class="big"></div><div class="info"><div class="nm"></div><div class="dt"></div></div><button class="del" title="删除">✕</button>';
    row.querySelector('.big').textContent = h.text;
    row.querySelector('.nm').textContent = ev.name;
    row.querySelector('.dt').textContent = new Date(ev.date).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    row.querySelector('.del').addEventListener('click', () => { removeEvent(board, ev.id); persist(); render(); });
    listEl.appendChild(row);
  }
}

document.getElementById('form').addEventListener('submit', (e) => {
  e.preventDefault();
  const r = addEvent(board, nameEl.value, dateEl.value);
  if (r.ok) { nameEl.value = ''; dateEl.value = ''; persist(); render(); }
  else alert(r.reason);
});
render();
setInterval(render, 30_000);
`;

  const html = pageShell(
    spec.title,
    spec.subtitle,
    `<div class="card">
  <form id="form" class="row">
    <input id="name" class="grow" placeholder="事件名称，如：我的生日" autocomplete="off" />
    <input id="date" type="date" style="flex:0 0 170px" />
    <button class="primary" type="submit">添加</button>
  </form>
</div>
<div id="list"></div>`,
  );

  const css = buildThemeCss(getStyleDef(spec)) + `
.ev { display: flex; align-items: center; gap: 16px; background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 16px 18px; margin-bottom: 12px; }
.ev .big { font-size: 20px; font-weight: 800; color: var(--accent); min-width: 110px; font-variant-numeric: tabular-nums; }
.ev .info { flex: 1; min-width: 0; }
.ev .nm { font-size: 16px; font-weight: 600; }
.ev .dt { color: var(--text-dim); font-size: 12.5px; margin-top: 3px; }
.ev .del { border: none; background: none; color: var(--text-faint); font-size: 14px; padding: 6px 8px; }
.ev .del:hover { color: #ff5470; }
.ev.passed { opacity: .55; }
.ev.passed .big { color: var(--text-dim); }
.ev.today { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent), 0 8px 32px rgba(0,0,0,.35); }
`;

  return {
    'index.html': html,
    'style.css': css,
    'app.mjs': app,
    'logic.mjs': logic,
    'test/logic.test.mjs': test,
    'package.json': JSON.stringify({ name: 'app-countdown', private: true, type: 'module' }, null, 2),
  };
}

export function defectVariant(f) {
  return {
    ...f,
    'logic.mjs': f['logic.mjs'].replace(
      'return Math.round((dayA - dayB) / DAY);',
      'return Math.round((ts - now) / DAY); // [预设缺陷] 未按本地日历日取整',
    ),
  };
}

export function fixedLogic(f) {
  return f['logic.mjs'];
}
