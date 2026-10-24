/**
 * M7-B4B 视觉证据截图：把离线产物渲染成若干张整页/分段 PNG，供人工与视觉验收审查。
 * 用法：node tools/m7b4b/capture-shots.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const SITE = path.join(ROOT, 'docs', 'm7-b4b-evidence', 'site', 'index.html');
const OUT = path.join(ROOT, 'docs', 'm7-b4b-evidence', 'shots');
const EDGE = process.env.RENDERCHECK_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const { launchCdp } = await import(pathToFileURL(path.join(ROOT, 'apps', 'server', 'cdp-viewport.mjs')).href);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(OUT, { recursive: true });
const cdp = await launchCdp({ edgeBin: EDGE });
let sid = null;
let tid = null;
const ev = async (expression) => {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid);
  return r?.result?.value;
};
const shoot = async (name) => {
  const cap = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true }, sid);
  fs.writeFileSync(path.join(OUT, name), Buffer.from(cap.data, 'base64'));
  console.log('shot', name);
};
try {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  tid = targetId;
  sid = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await cdp.send('Page.enable', {}, sid);
  await cdp.send('Runtime.enable', {}, sid);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900,
  }, sid);
  await cdp.send('Page.navigate', { url: pathToFileURL(SITE).href }, sid);
  await cdp.waitEvent('Page.loadEventFired', sid, 8000);
  await sleep(2200);

  await shoot('01-hero.png');

  const ids = await ev(`[...document.querySelectorAll('section[id]')].map(s => s.id)`);
  for (let i = 0; i < (ids ?? []).length; i++) {
    await ev(`document.getElementById(${JSON.stringify(ids[i])}).scrollIntoView({block:'start'})`);
    await sleep(600);
    await shoot(`0${i + 2}-${ids[i]}.png`);
  }
  // 整页长图（拼接式，用于看节奏）
  const full = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true }, sid);
  fs.writeFileSync(path.join(OUT, '00-fullpage.png'), Buffer.from(full.data, 'base64'));
  console.log('shot 00-fullpage.png');
  console.log('sections:', JSON.stringify(ids));
} finally {
  if (tid) { try { await cdp.send('Target.closeTarget', { targetId: tid }); } catch {} }
  try { await cdp.close(); } catch {}
}
