/**
 * M7-B4B 交互验证：真实浏览器里点击页面的原生交互（details 展开、锚点跳转、Tab 顺序）。
 * 用 CDP 精确视口驱动，指向 docs/m7-b4b-evidence/site 的离线产物。
 * 说明：PagePlan 产物不含任何 JS，因此这里验证的是「无脚本也真实可用」的交互契约。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const SITE = path.join(ROOT, 'docs', 'm7-b4b-evidence', 'site', 'index.html');
const { launchCdp } = await import(pathToFileURL(path.join(ROOT, 'apps', 'server', 'cdp-viewport.mjs')).href);

const checks = [];
const ok = (n, d = '') => { checks.push({ pass: true, n }); console.log(`✔ ${n}${d ? '  ' + d : ''}`); };
const bad = (n, d = '') => { checks.push({ pass: false, n, d }); console.log(`✖ ${n}  ${d}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EDGE = process.env.RENDERCHECK_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const cdp = await launchCdp({ edgeBin: EDGE });
let sid = null;
let tid = null;
const ev = async (expression) => {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid);
  return r?.result?.value;
};

try {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  tid = targetId;
  const attached = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  sid = attached.sessionId;
  await cdp.send('Page.enable', {}, sid);
  await cdp.send('Runtime.enable', {}, sid);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900,
  }, sid);
  await cdp.send('Page.navigate', { url: pathToFileURL(SITE).href }, sid);
  await cdp.waitEvent('Page.loadEventFired', sid, 8000);
  await sleep(500);
  ok('离线产物在真实浏览器中加载');

  // 1) 原生 details 交互（用固定 id 定位；点击后该元素不再是"第一个未展开"，不能重复按选择器取）
  const detailsId = await ev(`document.querySelector('details.pp-details:not([open])')?.id ?? null`);
  if (!detailsId) {
    bad('页面无未展开的原生 details 可验证');
  } else {
    const before = await ev(`document.getElementById(${JSON.stringify(detailsId)}).open`);
    await ev(`document.querySelector('#${detailsId} summary').click()`);
    await sleep(200);
    const after = await ev(`document.getElementById(${JSON.stringify(detailsId)}).open`);
    (before === false && after === true)
      ? ok('原生 details 点击后展开（无需脚本）', `#${detailsId}: ${before} → ${after}`)
      : bad('details 未展开', `#${detailsId}: ${before} → ${after}`);
  }

  // 2) 导航锚点跳转
  const hrefs = await ev(`[...document.querySelectorAll('.pp-nav a')].map(a => a.getAttribute('href'))`);
  if ((hrefs ?? []).length >= 2) {
    await ev(`window.scrollTo(0,0)`);
    await sleep(120);
    await ev(`document.querySelectorAll('.pp-nav a')[1].click()`);
    await sleep(1200);
    const v = await ev(`(() => { const a = document.querySelectorAll('.pp-nav a')[1]; const t = document.querySelector(a.getAttribute('href')); return { y: Math.round(window.scrollY), top: t ? Math.round(t.getBoundingClientRect().top) : null }; })()`);
    const scrolled = (v?.y ?? 0) > 100;
    const aligned = Math.abs(v?.top ?? 999) < 150;
    (scrolled && aligned) ? ok('导航锚点滚动到目标章节', `scrollY=${v.y} 目标顶部=${v.top}`) : bad('锚点跳转失败', JSON.stringify(v));
  } else bad('导航链接不足 2 个', JSON.stringify(hrefs));

  // 3) Tab 顺序：首个可聚焦元素应为跳过导航
  await ev(`window.scrollTo(0,0); document.querySelector('a.pp-skip')?.blur(); document.body.setAttribute('tabindex','-1'); document.body.focus();`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sid);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sid);
  await sleep(250);
  const f = await ev(`({ cls: document.activeElement?.className ?? '', text: (document.activeElement?.textContent ?? '').trim().slice(0, 20) })`);
  String(f?.cls ?? '').includes('pp-skip') ? ok('键盘 Tab 首先到达「跳转到主要内容」', f.text) : bad('Tab 顺序异常', JSON.stringify(f));

  // 4) 静态可读性：全部内容无需脚本即可呈现
  const c = await ev(`({ sections: document.querySelectorAll('section').length, cards: document.querySelectorAll('.pp-card').length, scripts: document.querySelectorAll('script').length })`);
  (c?.sections >= 4 && c?.cards >= 4 && c?.scripts === 0)
    ? ok('内容为静态 HTML，无脚本即可完整呈现', `sections=${c.sections} cards=${c.cards} scripts=${c.scripts}`)
    : bad('内容依赖脚本或结构缺失', JSON.stringify(c));

  // 5) 键盘焦点可见性：跳过链接获得焦点后必须真正进入视口（不能被 left:-9999px 卡住）
  const skipBox = await ev(`(() => { const s = document.querySelector('a.pp-skip'); if (!s) return null; s.focus(); const r = s.getBoundingClientRect(); return { left: Math.round(r.left), focused: document.activeElement === s }; })()`);
  (skipBox?.focused && skipBox.left >= 0) ? ok('跳过导航链接聚焦后可见（键盘无障碍）', `left=${skipBox.left}`) : bad('跳过链接聚焦后不可见', JSON.stringify(skipBox));
} catch (e) {
  bad('交互验证异常', String(e?.message ?? e).slice(0, 300));
} finally {
  if (tid) { try { await cdp.send('Target.closeTarget', { targetId: tid }); } catch {} }
  try { await cdp.close(); } catch {}
  const pass = checks.filter((x) => x.pass).length;
  console.log(`\n=== ${pass}/${checks.length} 通过 ===`);
  fs.writeFileSync(path.join(ROOT, 'docs', 'm7-b4b-evidence', 'interaction.json'), JSON.stringify(checks, null, 2));
  process.exit(pass === checks.length ? 0 : 1);
}
