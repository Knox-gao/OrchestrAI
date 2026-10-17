/** 模板：番茄钟 —— 专注/休息循环计时 + 会话统计 */
import { buildThemeCss, pageShell } from '../theme.mjs';
import { getStyleDef } from '../styles.mjs';

export const meta = {
  type: 'pomodoro',
  name: '番茄钟',
  keywords: ['番茄', '计时', '专注', 'pomodoro', 'timer', '钟'],
  accent: '#ff5470', accentRgb: '255,84,112',
  features: ['25 分钟专注 / 5 分钟休息自动切换', '开始 / 暂停 / 重置', '今日完成番茄数统计', '阶段进度提示'],
};

export function files(spec) {
  const logic = `export const FOCUS_SEC = 25 * 60;
export const BREAK_SEC = 5 * 60;

export function createTimer() {
  return { phase: 'focus', remainingSec: FOCUS_SEC, running: false, sessions: 0 };
}

export function start(t) { t.running = true; return t; }
export function pause(t) { t.running = false; return t; }

export function reset(t) {
  t.running = false;
  t.phase = 'focus';
  t.remainingSec = FOCUS_SEC;
  return t;
}

/** 推进 elapsedSec 秒：到点自动切换阶段并累计会话 */
export function tick(t, elapsedSec) {
  if (!t.running || elapsedSec <= 0) return t;
  t.remainingSec -= elapsedSec;
  while (t.remainingSec <= 0) {
    if (t.phase === 'focus') {
      t.sessions += 1;
      t.phase = 'break';
      t.remainingSec += BREAK_SEC;
    } else {
      t.phase = 'focus';
      t.remainingSec += FOCUS_SEC;
    }
  }
  return t;
}

export function formatDuration(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
`;

  const test = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTimer, start, pause, reset, tick, formatDuration, FOCUS_SEC, BREAK_SEC } from '../logic.mjs';

test('初始状态：专注阶段 25:00 未运行', () => {
  const t = createTimer();
  assert.equal(t.phase, 'focus');
  assert.equal(t.running, false);
  assert.equal(t.remainingSec, FOCUS_SEC);
});

test('formatDuration 分钟秒数格式（缺陷检测点）', () => {
  assert.equal(formatDuration(0), '00:00');
  assert.equal(formatDuration(65), '01:05');
  assert.equal(formatDuration(1500), '25:00');
  assert.equal(formatDuration(1500.9), '25:00', '小数秒必须向下取整');
});

test('未运行时 tick 不推进', () => {
  const t = createTimer();
  tick(t, 30);
  assert.equal(t.remainingSec, FOCUS_SEC);
});

test('专注结束自动进入休息并累计会话', () => {
  const t = start(createTimer());
  tick(t, FOCUS_SEC);
  assert.equal(t.phase, 'break');
  assert.equal(t.sessions, 1);
  assert.equal(t.remainingSec, BREAK_SEC);
});

test('休息结束回到专注', () => {
  const t = start(createTimer());
  tick(t, FOCUS_SEC + BREAK_SEC);
  assert.equal(t.phase, 'focus');
  assert.equal(t.sessions, 1);
});

test('暂停后可恢复，重置回初始', () => {
  const t = start(createTimer());
  pause(t);
  tick(t, 100);
  assert.equal(t.remainingSec, FOCUS_SEC);
  start(t);
  tick(t, 100);
  assert.equal(t.remainingSec, FOCUS_SEC - 100);
  reset(t);
  assert.equal(t.running, false);
  assert.equal(t.remainingSec, FOCUS_SEC);
});
`;

  const app = `import { createTimer, start, pause, reset, tick, formatDuration } from './logic.mjs';

const KEY = 'pomodoro-sessions-v1';
const timer = createTimer();
try { timer.sessions = Math.max(0, Number(localStorage.getItem(KEY) ?? 0)) || 0; } catch {}
const persist = () => { try { localStorage.setItem(KEY, String(timer.sessions)); } catch {} };
const timeEl = document.getElementById('time');
const phaseEl = document.getElementById('phase');
const sessionsEl = document.getElementById('sessions');
const ringEl = document.getElementById('ring-fill');

function paint() {
  const total = timer.phase === 'focus' ? 25 * 60 : 5 * 60;
  const pct = (1 - timer.remainingSec / total) * 100;
  timeEl.textContent = formatDuration(timer.remainingSec);
  phaseEl.textContent = timer.phase === 'focus' ? '🍅 专注中' : '☕ 休息一下';
  phaseEl.dataset.phase = timer.phase;
  sessionsEl.textContent = String(timer.sessions);
  ringEl.style.width = pct + '%';
  document.getElementById('btn-start').textContent = timer.running ? '暂停' : '开始';
  document.title = formatDuration(timer.remainingSec) + (timer.phase === 'focus' ? ' · 专注' : ' · 休息');
}

document.getElementById('btn-start').addEventListener('click', () => {
  timer.running ? pause(timer) : start(timer);
  paint();
});
document.getElementById('btn-reset').addEventListener('click', () => { reset(timer); persist(); paint(); });

let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const before = timer.sessions;
  if (timer.running) tick(timer, Math.round((now - last) / 1000));
  last = now;
  if (timer.sessions !== before) persist();
  paint();
}, 250);
paint();
`;

  const html = pageShell(
    `${spec.title}`,
    spec.subtitle,
    `<div class="card" style="text-align:center">
  <div id="phase" class="phase"></div>
  <div class="ring"><div class="ring-track"></div><div id="ring-fill" class="ring-fill"></div></div>
  <div id="time" class="time">25:00</div>
  <div class="row" style="justify-content:center;margin-top:18px">
    <button id="btn-start" class="primary" style="min-width:110px">开始</button>
    <button id="btn-reset">重置</button>
  </div>
</div>
<div class="card stat-card">
  <span>今日番茄</span><span id="sessions" class="num">0</span>
</div>`,
  );

  const css = buildThemeCss(getStyleDef(spec)) + `
.phase { font-size: 15px; color: var(--text-dim); margin-bottom: 14px; }
.phase[data-phase="focus"] { color: var(--accent); }
.time { font-size: 64px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: 2px; margin-top: 10px; }
.ring { height: 6px; border-radius: 3px; overflow: hidden; }
.ring-track, .ring-fill { height: 100%; border-radius: 3px; }
.ring-track { background: var(--panel-2); }
.ring-fill { background: linear-gradient(90deg, var(--accent), #9d4edd); width: 0%; transition: width .3s linear; }
.stat-card { display: flex; justify-content: space-between; align-items: center; color: var(--text-dim); }
.stat-card .num { font-size: 30px; font-weight: 700; color: var(--accent); }
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
      'const s = Math.max(0, Math.floor(sec));',
      'const s = Math.max(0, Math.round(sec)); // [预设缺陷] 秒数应向下取整',
    ),
  };
}

export function fixedLogic(f) {
  return f['logic.mjs'];
}
