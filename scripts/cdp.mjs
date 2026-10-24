/**
 * 极简 CDP 客户端：驱动演示录制用。
 *
 * 只依赖 Node 内置的全局 WebSocket（Node 22+），不引入 puppeteer。
 * 用法见文件末尾的 CLI 分支，也可以 import 后当作库用。
 */

const DEBUG_HTTP = 'http://127.0.0.1:9222';

export async function listTargets() {
  const res = await fetch(`${DEBUG_HTTP}/json/list`);
  return res.json();
}

export async function findPage(match = 'localhost:5175') {
  const targets = await listTargets();
  const pages = targets.filter((t) => t.type === 'page');
  return pages.find((t) => t.url.includes(match)) ?? pages[0] ?? null;
}

export class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
        return;
      }
      if (msg.method && this.listeners.has(msg.method)) {
        for (const fn of this.listeners.get(msg.method)) fn(msg.params);
      }
    });
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('websocket connect failed')), { once: true });
    });
    return new CDP(ws);
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(fn);
    return () => this.listeners.get(method).delete(fn);
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout: ${method}`));
        }
      }, 60_000);
    });
  }

  async eval(expression, { awaitPromise = true, returnByValue = true } = {}) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      throw new Error(`eval failed: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`);
    }
    return r.result?.value;
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* noop */
    }
  }
}

export async function connectPage(match) {
  const page = await findPage(match);
  if (!page) throw new Error('no page target');
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  return { cdp, page };
}

/**
 * 在页面里注入一个合成光标 + 点击涟漪。
 * 录屏是抓 OS 画面的，注入的元素会一起被录进去，所以观众能看到鼠标在动；
 * 同时我们不碰系统真实光标，避免打断用户正在做的其他事。
 */
export const CURSOR_OVERLAY = `
(() => {
  if (window.__demoCursor) return 'already';
  const css = [
    '#__demo_cursor{position:fixed;left:0;top:0;width:22px;height:22px;margin:-3px 0 0 -3px;',
    'z-index:2147483647;pointer-events:none;transition:transform .55s cubic-bezier(.22,.61,.36,1);',
    'filter:drop-shadow(0 2px 6px rgba(0,0,0,.55));will-change:transform}',
    '#__demo_ripple{position:fixed;left:0;top:0;width:46px;height:46px;margin:-23px 0 0 -23px;',
    'border-radius:50%;z-index:2147483646;pointer-events:none;opacity:0;',
    'background:radial-gradient(circle,rgba(113,220,202,.55) 0%,rgba(113,220,202,0) 70%);',
    'border:2px solid rgba(113,220,202,.85);transform:scale(.25)}',
    '#__demo_ripple.go{animation:__demoRipple .62s ease-out}',
    '@keyframes __demoRipple{0%{opacity:.95;transform:scale(.25)}100%{opacity:0;transform:scale(1.5)}}',
  ].join('');
  const style = document.createElement('style');
  style.textContent = css;
  document.documentElement.appendChild(style);

  const cursor = document.createElement('div');
  cursor.id = '__demo_cursor';
  cursor.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 2 L4 19 L9.2 14.4 L12.3 21.4 L15.1 20.2 L12.1 13.3 L18.6 13.3 Z" fill="#ffffff" stroke="#0b0f14" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  document.documentElement.appendChild(cursor);

  const ripple = document.createElement('div');
  ripple.id = '__demo_ripple';
  document.documentElement.appendChild(ripple);

  window.__demoCursor = { cursor, ripple };
  return 'ok';
})()
`;

/** 先把光标平滑移到元素中心，再点击。返回元素中心坐标（CSS px）。 */
export async function moveAndClick(cdp, selector, { settleMs = 620, useSelectorAll = false } = {}) {
  // 演示视频里不能用 instant 滚动，会像画面瞬移；先平滑滚到视野中再取坐标。
  await cdp.eval(`(() => {
    const nodes = document.querySelectorAll(${JSON.stringify(selector)});
    const el = nodes[0];
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const inside = r.top > 120 && r.bottom < window.innerHeight - 140;
    if (!inside) el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    return 1;
  })()`);
  await sleep(900);

  const meta = await cdp.eval(`(() => {
    const nodes = document.querySelectorAll(${JSON.stringify(selector)});
    const el = nodes[0];
    if (!el) return { ok: false, count: nodes.length };
    const r = el.getBoundingClientRect();
    return { ok: true, count: nodes.length, x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);

  if (!meta?.ok) throw new Error(`element not found: ${selector}`);

  await cdp.eval(`(() => {
    const c = window.__demoCursor;
    c.cursor.style.transform = 'translate(${meta.x}px, ${meta.y}px)';
    return 1;
  })()`);
  await sleep(settleMs);

  await cdp.eval(`(() => {
    const c = window.__demoCursor;
    c.ripple.style.transform = 'translate(${meta.x}px, ${meta.y}px)';
    c.ripple.classList.remove('go');
    void c.ripple.offsetWidth;
    c.ripple.classList.add('go');
    return 1;
  })()`);
  await cdp.eval(`(() => {
    const el = document.elementFromPoint(${meta.x}, ${meta.y});
    if (el) el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: ${meta.x}, clientY: ${meta.y} }));
    if (el) el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: ${meta.x}, clientY: ${meta.y} }));
    if (el) el.click();
    return el ? (el.tagName + ':' + (el.textContent || '').slice(0, 30)) : null;
  })()`);

  return meta;
}

export async function moveTo(cdp, x, y, settleMs = 500) {
  await cdp.eval(`(() => {
    const c = window.__demoCursor;
    if (c) c.cursor.style.transform = 'translate(${x}px, ${y}px)';
    return 1;
  })()`);
  await sleep(settleMs);
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 等待页面里某个条件成立（返回 truthy）。 */
export async function waitFor(cdp, expression, { timeoutMs = 30_000, intervalMs = 300, label = '' } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    let v;
    try {
      v = await cdp.eval(expression);
    } catch {
      v = false;
    }
    if (v) return v;
    await sleep(intervalMs);
  }
  throw new Error(`waitFor timeout${label ? ` (${label})` : ''}: ${expression.slice(0, 120)}`);
}
