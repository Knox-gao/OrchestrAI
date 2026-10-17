/** 模板：计数器 —— 自定义步进 / 历史记录 / 统计 */
import { buildThemeCss, pageShell } from '../theme.mjs';
import { getStyleDef } from '../styles.mjs';

export const meta = {
  type: 'counter',
  name: '计数器',
  keywords: ['计数', '次数', '统计', '打卡', '计数器', 'counter'],
  accent: '#ffd166', accentRgb: '255,209,102',
  features: ['加 / 减 / 自定义步进', '一键归零', '每次操作进入历史（可撤销上一条）', '今日累计统计'],
};

export function files(spec) {
  const logic = `export function createCounter(step = 1) {
  return { value: 0, step, history: [] };
}

export function setStep(c, step) {
  const s = Number(step);
  if (!Number.isFinite(s) || s <= 0) return { ok: false, reason: '步进必须为正数' };
  c.step = s;
  return { ok: true };
}

export function increment(c) {
  c.value += c.step;
  c.history.push({ at: Date.now(), delta: c.step, value: c.value });
  return c.value;
}

export function decrement(c) {
  c.value -= c.step;
  c.history.push({ at: Date.now(), delta: -c.step, value: c.value });
  return c.value;
}

export function undoLast(c) {
  const last = c.history.pop();
  if (!last) return { ok: false, reason: '没有可撤销的操作' };
  c.value -= last.delta;
  return { ok: true, value: c.value };
}

export function reset(c) {
  c.value = 0;
  c.history = [];
}

export function stats(c) {
  const plus = c.history.filter((h) => h.delta > 0).length;
  const minus = c.history.filter((h) => h.delta < 0).length;
  return { value: c.value, operations: c.history.length, plus, minus };
}
`;

  const test = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCounter, setStep, increment, decrement, undoLast, reset, stats } from '../logic.mjs';

test('默认步进为 1', () => {
  const c = createCounter();
  assert.equal(increment(c), 1);
  assert.equal(increment(c), 2);
});

test('自定义步进生效（缺陷检测点）', () => {
  const c = createCounter();
  setStep(c, 5);
  assert.equal(increment(c), 5, '步进 5 时第一次 +1 后应为 5');
  assert.equal(increment(c), 10);
});

test('非法步进被拒绝', () => {
  const c = createCounter();
  assert.equal(setStep(c, 0).ok, false);
  assert.equal(setStep(c, -3).ok, false);
  assert.equal(setStep(c, 'x').ok, false);
});

test('减法与撤销', () => {
  const c = createCounter();
  setStep(c, 2);
  increment(c); increment(c); decrement(c);
  assert.equal(c.value, 2);
  const r = undoLast(c);
  assert.equal(r.ok, true);
  assert.equal(c.value, 4);
  assert.equal(undoLast({ ...c, history: [] }).ok, false);
});

test('归零清空历史', () => {
  const c = createCounter();
  increment(c); increment(c);
  reset(c);
  assert.deepEqual(stats(c), { value: 0, operations: 0, plus: 0, minus: 0 });
});

test('统计口径', () => {
  const c = createCounter();
  increment(c); decrement(c); increment(c);
  assert.deepEqual(stats(c), { value: 1, operations: 3, plus: 2, minus: 1 });
});
`;

  const app = `import { createCounter, setStep, increment, decrement, undoLast, reset, stats } from './logic.mjs';

const KEY = 'counter-state-v1';
function hydrate() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!saved || typeof saved.value !== 'number') return createCounter();
    const c = createCounter(saved.step ?? 1);
    c.value = saved.value;
    c.history = Array.isArray(saved.history) ? saved.history.slice(-50) : [];
    return c;
  } catch { return createCounter(); }
}
const counter = hydrate();
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify({ value: counter.value, step: counter.step, history: counter.history.slice(-50) })); } catch {} };
const valueEl = document.getElementById('value');
const stepEl = document.getElementById('step');
const histEl = document.getElementById('history');
const statEl = document.getElementById('stat');

function render() {
  valueEl.textContent = String(counter.value);
  const st = stats(counter);
  statEl.textContent = \`共 \${st.operations} 次操作（+ \${st.plus} / − \${st.minus}）\`;
  const recent = counter.history.slice(-8).reverse();
  histEl.innerHTML = recent.length === 0
    ? '<div class="empty">还没有操作记录</div>'
    : recent.map((h) => \`<div class="hitem"><span class="\${h.delta > 0 ? 'up' : 'down'}">\${h.delta > 0 ? '+' : ''}\${h.delta}</span><span>→ \${h.value}</span><span class="t">\${new Date(h.at).toLocaleTimeString('zh-CN', { hour12: false })}</span></div>\`).join('');
}

document.getElementById('btn-inc').addEventListener('click', () => { increment(counter); persist(); render(); });
document.getElementById('btn-dec').addEventListener('click', () => { decrement(counter); persist(); render(); });
document.getElementById('btn-undo').addEventListener('click', () => { undoLast(counter); persist(); render(); });
document.getElementById('btn-reset').addEventListener('click', () => { if (confirm('确定归零？历史也会清空')) { reset(counter); persist(); render(); } });
stepEl.addEventListener('change', () => { if (setStep(counter, stepEl.value).ok) { persist(); render(); } else stepEl.value = String(counter.step); });
render();
`;

  const html = pageShell(
    `${spec.title}`,
    spec.subtitle,
    `<div class="card" style="text-align:center">
  <div id="value" class="big">0</div>
  <div class="row" style="justify-content:center;margin-top:16px">
    <button id="btn-dec" style="font-size:20px">−</button>
    <button id="btn-inc" class="primary" style="font-size:20px;min-width:72px">＋</button>
  </div>
  <div class="row" style="justify-content:center;margin-top:12px">
    <label class="stepl">步进 <input id="step" type="number" value="1" min="1" style="width:76px;text-align:center" /></label>
    <button id="btn-undo">撤销</button>
    <button id="btn-reset">归零</button>
  </div>
  <div id="stat" style="margin-top:14px;color:var(--text-dim);font-size:13px"></div>
</div>
<div class="card">
  <div style="color:var(--text-dim);font-size:13px;margin-bottom:8px">操作历史（最近 8 条）</div>
  <div id="history"></div>
</div>`,
  );

  const css = buildThemeCss(getStyleDef(spec)) + `
.big { font-size: 72px; font-weight: 800; font-variant-numeric: tabular-nums; }
.stepl { display: flex; align-items: center; gap: 8px; color: var(--text-dim); font-size: 14px; }
.hitem { display: flex; gap: 12px; padding: 8px 4px; border-bottom: 1px dashed var(--border); font-size: 14px; align-items: baseline; }
.hitem:last-child { border-bottom: none; }
.hitem .up { color: var(--accent); font-weight: 700; min-width: 34px; }
.hitem .down { color: #ff5470; font-weight: 700; min-width: 34px; }
.hitem .t { margin-left: auto; color: var(--text-dim); font-size: 12px; }
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
      'c.value += c.step;',
      'c.value += 1; // [预设缺陷] 忽略了自定义步进',
    ),
  };
}

export function fixedLogic(f) {
  return f['logic.mjs'];
}
