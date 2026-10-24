/**
 * 产品演示驱动：CDP 操作工作室界面 + 记录与录屏对齐的点击事件。
 *
 * 设计取舍：这条片子不调用真实模型（不消耗用户额度）。
 *   - 首页 → 起名创建项目：纯前端状态，不产生服务端对象
 *   - 「观看演示」：产品自带的多人协作流程演示，界面上本身就标注为演示
 *   - 「打开项目」：打开一份真实交付的工作区（PMVM8NC9A，7 道门禁全通过）
 * 片子里出现的站点、门禁结果、测试日志都是真实产物，没有伪造。
 *
 * 输出：
 *   recordings/<name>_events.json   与剪映 smart_zoomer 兼容（time = 录屏相对秒）
 *   recordings/<name>_script.json   分镜时间轴，供剪辑脚本加字幕
 *
 * 前提：Edge 以 --remote-debugging-port=9222 启动；录制器已写出 <name>_started.json。
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { CURSOR_OVERLAY, connectPage, moveAndClick, moveTo, sleep, waitFor } from './cdp.mjs';

const [, , outName] = process.argv;
if (!outName) {
  console.error('usage: node scripts/demo_drive.mjs <outName>');
  process.exit(1);
}

const startedPath = `recordings/${outName}_started.json`;
if (!existsSync(startedPath)) {
  console.error(`missing ${startedPath} — start the recorder first`);
  process.exit(1);
}
const started = JSON.parse(readFileSync(startedPath, 'utf8'));
const [rx, ry, rw, rh] = started.region;

const events = [];
const marks = [];
const now = () => Date.now() / 1000 - started.epoch;
const mark = (label, extra = {}) => marks.push({ label, t: Number(now().toFixed(3)), ...extra });

/** 视口内 CSS 坐标 → 录制画面归一化坐标（剪映 smart_zoomer 用 0-1 归一化）。 */
async function toNormalized(cdp, cssX, cssY) {
  const b = await cdp.eval('({sx:screenX,sy:screenY,ow:outerWidth,oh:outerHeight,iw:innerWidth,ih:innerHeight,dpr:devicePixelRatio})');
  const chromeX = Math.max(0, (b.ow - b.iw) / 2);
  const chromeY = Math.max(0, b.oh - b.ih);
  const px = (b.sx + cssX + chromeX) * b.dpr;
  const py = (b.sy + cssY + chromeY) * b.dpr;
  return { x: Number(((px - rx) / rw).toFixed(4)), y: Number(((py - ry) / rh).toFixed(4)) };
}

async function recordClick(cdp, cssX, cssY, flags = {}) {
  const n = await toNormalized(cdp, cssX, cssY);
  events.push({ type: 'click', time: Number(now().toFixed(3)), x: n.x, y: n.y, ...flags });
  return n;
}

async function clickSelector(cdp, selector, label, { nav = false } = {}) {
  const meta = await moveAndClick(cdp, selector);
  const at = await recordClick(cdp, meta.x, meta.y, nav ? { nav: true } : {});
  mark(label, { at });
  return meta;
}

async function clickByText(cdp, selector, text, label, { nav = false } = {}) {
  await cdp.eval(`(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const el = nodes.find((n) => (n.textContent || '').includes(${JSON.stringify(text)}));
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const inside = r.top > 120 && r.bottom < window.innerHeight - 140;
    if (!inside) el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    return 1;
  })()`);
  await sleep(950);
  const meta = await cdp.eval(`(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const el = nodes.find((n) => (n.textContent || '').includes(${JSON.stringify(text)}));
    if (!el) return { ok: false };
    const r = el.getBoundingClientRect();
    return { ok: true, x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!meta?.ok) throw new Error(`text not found: ${text}`);

  await cdp.eval(`(() => { const c = window.__demoCursor; c.cursor.style.transform = 'translate(${meta.x}px, ${meta.y}px)'; return 1; })()`);
  await sleep(640);
  await cdp.eval(`(() => {
    const c = window.__demoCursor;
    c.ripple.style.transform = 'translate(${meta.x}px, ${meta.y}px)';
    c.ripple.classList.remove('go'); void c.ripple.offsetWidth; c.ripple.classList.add('go');
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const el = nodes.find((n) => (n.textContent || '').includes(${JSON.stringify(text)}));
    if (el) el.click();
    return 1;
  })()`);
  const at = await recordClick(cdp, meta.x, meta.y, nav ? { nav: true } : {});
  mark(label, { at });
}

async function clickCardByText(cdp, text, label, { nav = false } = {}) {
  const sel = '.proj-card';
  await cdp.eval(`(() => {
    const card = [...document.querySelectorAll('${sel}')].find((c) => (c.textContent || '').includes(${JSON.stringify(text)}));
    if (card) card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return 1;
  })()`);
  await sleep(1100);
  const meta = await cdp.eval(`(() => {
    const card = [...document.querySelectorAll('${sel}')].find((c) => (c.textContent || '').includes(${JSON.stringify(text)}));
    if (!card) return { ok: false };
    const btn = card.querySelector('.open-project-button');
    if (!btn) return { ok: false };
    const r = btn.getBoundingClientRect();
    return { ok: true, x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!meta?.ok) throw new Error(`card not found: ${text}`);
  await cdp.eval(`(() => { const c = window.__demoCursor; c.cursor.style.transform = 'translate(${meta.x}px, ${meta.y}px)'; return 1; })()`);
  await sleep(680);
  await cdp.eval(`(() => {
    const c = window.__demoCursor;
    c.ripple.style.transform = 'translate(${meta.x}px, ${meta.y}px)';
    c.ripple.classList.remove('go'); void c.ripple.offsetWidth; c.ripple.classList.add('go');
    const target = [...document.querySelectorAll('${sel}')]
      .find((c) => (c.textContent || '').includes(${JSON.stringify(text)}));
    const btn = target && target.querySelector('.open-project-button');
    if (btn) btn.click();
    return 1;
  })()`);
  const at = await recordClick(cdp, meta.x, meta.y, nav ? { nav: true } : {});
  mark(label, { at });
}

/** 真实输入事件，保证 React 受控组件收到 onChange。 */
async function typeInto(cdp, selector, text, { perChar = 62 } = {}) {
  const box = await cdp.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const inside = r.top > 120 && r.bottom < window.innerHeight - 140;
    if (!inside) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!box) throw new Error(`input not found: ${selector}`);
  await sleep(950);

  const fresh = await cdp.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  await cdp.eval(`(() => { const c = window.__demoCursor; c.cursor.style.transform = 'translate(${fresh.x}px, ${fresh.y}px)'; return 1; })()`);
  await sleep(520);
  await cdp.eval(`(() => {
    const c = window.__demoCursor;
    c.ripple.style.transform = 'translate(${fresh.x}px, ${fresh.y}px)';
    c.ripple.classList.remove('go'); void c.ripple.offsetWidth; c.ripple.classList.add('go');
    document.querySelector(${JSON.stringify(selector)}).focus();
    return 1;
  })()`);
  await sleep(260);

  for (const ch of text) {
    await cdp.send('Input.insertText', { text: ch });
    await sleep(perChar);
  }
  await recordClick(cdp, fresh.x, fresh.y, { typing: true });
}

async function main() {
  const { cdp } = await connectPage('localhost:5175');
  await cdp.eval('window.scrollTo(0,0)');
  await cdp.eval(CURSOR_OVERLAY);
  await waitFor(cdp, '!!document.querySelector("#project-name")', { label: 'home ready' });
  await sleep(900);

  // ── 1. 首页 ────────────────────────────────────────────────
  mark('scene:home');
  await moveTo(cdp, 900, 340, 800);
  await sleep(1200);

  // ── 2. 选风格 ──────────────────────────────────────────────
  await clickByText(cdp, '.featured-style-grid .style-card', '鎏金奢华', 'scene:pick-style');
  await sleep(1300);

  // ── 3. 起名并创建 ──────────────────────────────────────────
  await typeInto(cdp, '#project-name', '漫威英雄图鉴');
  await sleep(700);
  await clickSelector(cdp, '.go.primary-go', 'scene:create-project', { nav: true });

  // ── 4. 工作室：像素办公室 + 对话面板 ───────────────────────
  await waitFor(cdp, '!!document.querySelector(".dock-input textarea")', { label: 'dock ready', timeoutMs: 25_000 });
  await sleep(2200);
  mark('scene:studio');
  await moveTo(cdp, 980, 470, 1000);
  await sleep(2400);

  // 在需求框里打出这一版的目标需求（不发送：不消耗真实模型额度）
  await typeInto(cdp, '.dock-input textarea', '生成漫威所有超级英雄的介绍网页，要带照片和介绍', { perChar: 58 });
  await sleep(2000);
  mark('scene:requirement-typed');

  // ── 5. 返回首页，打开真实交付的项目 ────────────────────────
  await clickSelector(cdp, '.topbar .home-btn', 'scene:back-home', { nav: true });
  await sleep(2400);
  await cdp.eval('window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })');
  await sleep(2200);
  mark('scene:library');
  await clickCardByText(cdp, 'AE86', 'scene:open-delivered', { nav: true });
  await sleep(3200);

  // ── 6. 真实项目的门禁与测试 ────────────────────────────────
  mark('scene:delivered-project');
  await clickByText(cdp, '.detail .tabs button', '测试', 'scene:tab-test');
  await sleep(3000);
  await clickByText(cdp, '.detail .tabs button', '事件', 'scene:tab-events');
  await sleep(3200);

  // ── 7. 预览真实生成的网站（先看内嵌预览页签） ──────────────
  await clickByText(cdp, '.detail .tabs button', '预览', 'scene:tab-preview');
  await sleep(4000);
  mark('scene:preview-embed');

  const previewUrl = await cdp.eval('(() => { const f = document.querySelector("iframe.preview-frame"); return f ? f.src : null; })()');
  if (!previewUrl) throw new Error('preview iframe missing');

  // ── 8. 整屏浏览成品网站 ────────────────────────────────────
  await cdp.send('Page.navigate', { url: previewUrl });
  await waitFor(cdp, 'document.readyState === "complete" && document.body && document.body.scrollHeight > 600', {
    timeoutMs: 40_000, intervalMs: 400, label: 'site loaded',
  });
  await sleep(2600);
  mark('scene:site-full', { url: previewUrl });

  const total = await cdp.eval('document.documentElement.scrollHeight');
  const step = Math.round((total - 900) / 7);
  for (let i = 1; i <= 7; i += 1) {
    await cdp.eval(`window.scrollTo({ top: ${i * step}, behavior: 'smooth' })`);
    await sleep(2300);
  }
  await sleep(1500);

  mark('scene:end');
  writeFileSync(`recordings/${outName}_events.json`, JSON.stringify(events, null, 2));
  writeFileSync(`recordings/${outName}_script.json`, JSON.stringify({ marks, ok: true }, null, 2));
  writeFileSync(`tmp/${outName}.stop`, '1');
  console.log(JSON.stringify({ ok: true, clicks: events.length, marks: marks.length, seconds: Number(now().toFixed(1)) }, null, 2));
  cdp.close();
}

main().catch((e) => {
  console.error('driver failed:', e.message);
  try {
    writeFileSync(`recordings/${outName}_events.json`, JSON.stringify(events, null, 2));
    writeFileSync(`recordings/${outName}_script.json`, JSON.stringify({ marks, ok: false, error: e.message }, null, 2));
    writeFileSync(`tmp/${outName}.stop`, '1');
  } catch {
    /* noop */
  }
  process.exit(1);
});
