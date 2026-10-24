/**
 * CDP 精确视口驱动（修复 rendercheck 假通过）
 *
 * 根因：Edge/Chrome 的 `--window-size=390,844` 会被最小窗口宽度钳制（实测 390 → 517/477 CSS px），
 * 而截图仍按 390px 输出 → 页面按 477px 布局后被裁切，且 scrollW===clientW 恒成立，
 * overflowX 检查在同一布局内永远通过，永远发现不了裁切。
 *
 * 正确做法：CDP `Emulation.setDeviceMetricsOverride` 设置真实 CSS 布局视口（含 mobile 语义），
 * 然后再截图与探测，使「目标视口 == 实际布局视口 == 截图宽度」三者一致。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 启动 headless Edge 并返回 { send, browserWsUrl, close }。
 * 使用 --remote-debugging-port=0 让浏览器自选端口，从 user-data-dir/DevToolsActivePort 读取。
 */
export async function launchCdp({ edgeBin, timeoutMs = 20_000, extraArgs = [] } = {}) {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-cdp-'));
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-sync',
    '--remote-debugging-port=0', `--user-data-dir=${userDir}`,
    ...extraArgs, 'about:blank',
  ];
  const proc = spawn(edgeBin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const portFile = path.join(userDir, 'DevToolsActivePort');

  let port = 0;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(portFile)) {
      const txt = fs.readFileSync(portFile, 'utf8').trim();
      const first = txt.split(/\r?\n/)[0];
      if (first && Number(first) > 0) { port = Number(first); break; }
    }
    if (proc.exitCode !== null) break;
    await sleep(80);
  }
  if (!port) {
    try { proc.kill(); } catch {}
    throw new Error('CDP 启动失败：未读到 DevToolsActivePort');
  }

  // 浏览器级 WebSocket
  const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const browserWsUrl = ver.webSocketDebuggerUrl;
  const ws = new WebSocket(browserWsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('CDP WebSocket 连接失败')), { once: true });
  });

  let seq = 0;
  const pending = new Map();
  const eventWaiters = [];   // { method, sessionId, resolve }
  const eventListeners = new Set();  // (method, params, sessionId) => void
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.code}: ${msg.error.message}`));
      else resolve(msg.result);
      return;
    }
    if (msg.method) {
      for (const fn of eventListeners) { try { fn(msg.method, msg.params, msg.sessionId); } catch {} }
      for (let i = eventWaiters.length - 1; i >= 0; i--) {
        const w = eventWaiters[i];
        if (w.method === msg.method && (!w.sessionId || w.sessionId === msg.sessionId)) {
          eventWaiters.splice(i, 1);
          w.resolve(msg.params);
        }
      }
    }
  });

  /** 发送 CDP 命令（可带 sessionId 路由到目标页） */
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`CDP 超时: ${method}`)); } }, 30_000);
  });

  /** 等待某个 CDP 事件（带超时，超时返回 null 而非抛错） */
  const waitEvent = (method, sessionId, timeoutMs = 8000) => new Promise((resolve) => {
    const entry = { method, sessionId, resolve };
    eventWaiters.push(entry);
    setTimeout(() => {
      const i = eventWaiters.indexOf(entry);
      if (i >= 0) { eventWaiters.splice(i, 1); resolve(null); }
    }, timeoutMs);
  });

  /** 订阅所有 CDP 事件（用于收集 console/exception/log），返回取消订阅函数 */
  const onEvent = (fn) => { eventListeners.add(fn); return () => eventListeners.delete(fn); };

  const close = async () => {
    try { ws.close(); } catch {}
    try { proc.kill(); } catch {}
    await sleep(120);
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  };

  return { send, waitEvent, onEvent, port, userDir, close, proc };
}

/**
 * 在精确视口中打开 URL，采集真实布局指标 + 截图。
 * @returns {{ok:boolean, error?:string, metrics?:Object, shot?:Buffer, shotW?:number, shotH?:number}}
 */
/**
 * 自适应等待图片稳定：所有图片 complete 或状态在 stallMs 内不再变化即返回。
 * 有界超时兜底，绝不无限等待；未加载的图片仍会被探针判为失败（不降低门禁强度）。
 */
async function waitForImagesToSettle(cdp, sessionId, { timeoutMs = 6000, stallMs = 1200, pollMs = 150 } = {}) {
  const startedAt = Date.now();
  let lastSig = '';
  let lastChangeAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    let sig;
    try {
      const r = await cdp.send('Runtime.evaluate', {
        expression: `(() => { const imgs = [...document.images]; return imgs.length + ':' + imgs.map(i => (i.complete ? 1 : 0) + ',' + (i.naturalWidth > 0 ? 1 : 0)).join(''); })()`,
        returnByValue: true,
      }, sessionId);
      sig = String(r?.result?.value ?? '');
    } catch {
      return;
    }
    const allSettled = /^(\d+):(?:1,1)*$/.test(sig);
    if (allSettled) return;
    if (sig !== lastSig) { lastSig = sig; lastChangeAt = Date.now(); }
    else if (Date.now() - lastChangeAt >= stallMs) return;
    await sleep(pollMs);
  }
}

export async function captureAtViewport(cdp, { url, width, height, mobile, waitMs = 1800, screenshot = true, imageWaitMs = 6000 }) {
  const { send } = cdp;
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  try {
    await send('Page.enable', {}, sessionId);
    await send('Runtime.enable', {}, sessionId);

    // 关键：真实 CSS 视口覆盖（取代被钳制的 --window-size）
    await send('Emulation.setDeviceMetricsOverride', {
      width, height,
      deviceScaleFactor: 1,
      mobile: !!mobile,
      screenWidth: width,
      screenHeight: height,
      screenOrientation: { type: height >= width ? 'portraitPrimary' : 'landscapePrimary', angle: 0 },
    }, sessionId);
    // 触屏语义（仅 mobile）
    if (mobile) {
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId);
    }

    await send('Page.navigate', { url }, sessionId);
    // 等真实 load 事件（超时则退化为固定等待，指标仍以运行时实测为准）
    await cdp.waitEvent('Page.loadEventFired', sessionId, 8000);
    await sleep(waitMs);
    // 远程图片可能晚于 load 事件：自适应等待图片"停止变化"（有界），
    // 否则固定等待会在慢网上把合法页面误判为"必需图片未加载"。
    await waitForImagesToSettle(cdp, sessionId, { timeoutMs: imageWaitMs });

    // 真实布局指标（含目标/实际视口对照 + 图片完整性 + 元素裁切）
    const probeExpr = `(() => {
      const de = document.documentElement;
      const vv = window.visualViewport;
      const vh = window.innerHeight;
      // 图片三态：必需（非懒加载 或 首屏内懒加载）/ 懒加载（首屏下）
      const imgs = [...document.images].filter(i => i.getAttribute('src') || i.srcset);
      const required = imgs.filter(i => i.loading !== 'lazy' || i.getBoundingClientRect().top < vh);
      const lazy = imgs.filter(i => i.loading === 'lazy' && i.getBoundingClientRect().top >= vh);
      const failedOf = (a) => a.filter(i => !i.complete || i.naturalWidth === 0).length;
      // 检测被裁切的内容：元素右边缘超出布局视口，且**其祖先没有提供横向滚动**。
      // 设计明确的横向滚动容器（overflow-x:auto/scroll）内的内容超出视口是正常交互，
      // 不能算作裁切缺陷（此前把 atlas 底部 chips 横向列表误判为溢出）。
      let clipped = 0, clippedSample = null;
      const cw = de.clientWidth;
      const inScrollableX = (el) => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === 'auto' || ox === 'scroll') return true;
        }
        return false;
      };
      for (const el of document.body ? document.body.querySelectorAll('*') : []) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > cw + 1) {
          if (inScrollableX(el)) continue;
          clipped++;
          if (!clippedSample) clippedSample = (el.tagName + '.' + String(el.className || '').split(' ')[0]).slice(0, 40) + ' right=' + Math.round(r.right);
        }
      }
      const metaVP = document.querySelector('meta[name=viewport]');
      return {
        innerWidth, innerHeight,
        clientW: de.clientWidth, clientH: de.clientHeight,
        scrollW: de.scrollWidth, scrollH: de.scrollHeight,
        visualVPW: vv ? Math.round(vv.width) : null,
        dpr: devicePixelRatio,
        metaViewport: metaVP ? metaVP.getAttribute('content') : null,
        overflowX: de.scrollWidth > de.clientWidth + 1,
        required: required.length, requiredFailed: failedOf(required),
        lazy: lazy.length, lazyFailed: failedOf(lazy),
        clippedCount: clipped, clippedSample,
        buttons: document.querySelectorAll('button,input,select,textarea').length,
        h1: document.querySelector('h1') ? document.querySelector('h1').textContent.trim().slice(0, 40) : null,
      };
    })()`;
    const { result } = await send('Runtime.evaluate', { expression: probeExpr, returnByValue: true, awaitPromise: true }, sessionId);
    const metrics = result.value;

    let shot = null, shotW = 0, shotH = 0;
    if (screenshot) {
      const cap = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true }, sessionId);
      shot = Buffer.from(cap.data, 'base64');
      // PNG IHDR: 宽高位于 16..24
      if (shot.length > 24) { shotW = shot.readUInt32BE(16); shotH = shot.readUInt32BE(20); }
    }
    return { ok: true, metrics, shot, shotW, shotH, sessionId, targetId };
  } catch (e) {
    return { ok: false, error: String(e.message ?? e).slice(0, 160) };
  } finally {
    try { await send('Target.closeTarget', { targetId }); } catch {}
  }
}
