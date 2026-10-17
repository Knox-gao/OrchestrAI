/**
 * 零依赖代理层：让被墙图源（DuckDuckGo / Wikimedia 等）走系统代理（梯子），其余直连。
 * 探测顺序：环境变量 HTTPS_PROXY/HTTP_PROXY/ALL_PROXY → 本机常见代理端口 TCP 探测。
 * 实现：HTTP CONNECT 隧道 + TLS 包装 + http 模块解析（全部 node: 内置，无第三方依赖）。
 * 任何一步失败都回退直连，绝不阻断采集链。
 */
import http from 'node:http';
import tls from 'node:tls';
import net from 'node:net';

const PROBE_PORTS = [7890, 7891, 7892, 7893, 7894, 7897, 10808, 10809, 1080, 2080, 8118, 8889, 9910, 33210];
let cachedProxy;

function probePort(port, timeout = 700) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port, timeout });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.on('timeout', () => { s.destroy(); resolve(false); });
  });
}

/** 探测本机代理（结果缓存）。返回 {host, port} 或 null。 */
export async function detectProxy(force = false) {
  if (!force && cachedProxy !== undefined) return cachedProxy;
  let result = null;
  const envUrl = process.env.HTTPS_PROXY || process.env.https_proxy
    || process.env.ALL_PROXY || process.env.all_proxy
    || process.env.HTTP_PROXY || process.env.http_proxy;
  try {
    if (envUrl) {
      const u = new URL(envUrl.includes('://') ? envUrl : `http://${envUrl}`);
      result = { host: u.hostname || '127.0.0.1', port: Number(u.port) || 7890 };
    } else {
      for (const p of PROBE_PORTS) {
        if (await probePort(p)) { result = { host: '127.0.0.1', port: p }; break; }
      }
    }
  } catch { /* 探测失败视为无代理 */ }
  cachedProxy = result;
  return result;
}

/**
 * 经代理抓取 https 资源（CONNECT 隧道）。
 * @returns {Promise<{status:number, ok:boolean, buf:Buffer}>}
 */
export function proxyFetch(url, { headers = {}, timeout = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    detectProxy().then((proxy) => {
      if (!proxy) return reject(new Error('未探测到可用代理'));
      const target = new URL(url);
      const req = http.request({
        host: proxy.host, port: proxy.port, method: 'CONNECT',
        path: `${target.hostname}:443`, timeout,
      });
      req.on('connect', (res, socket) => {
        if (res.statusCode !== 200) {
          socket.destroy();
          return reject(new Error(`代理 CONNECT 失败：${res.statusCode}`));
        }
        const tlsSock = tls.connect({ socket, servername: target.hostname }, () => {
          const get = http.request({
            createConnection: () => tlsSock,
            host: target.hostname,
            path: target.pathname + target.search,
            method: 'GET',
            headers: { ...headers, Host: target.hostname },
            timeout,
          }, (r2) => {
            const chunks = [];
            r2.on('data', (c) => chunks.push(c));
            r2.on('end', () => resolve({ status: r2.statusCode || 0, ok: (r2.statusCode || 0) >= 200 && (r2.statusCode || 0) < 300, buf: Buffer.concat(chunks) }));
          });
          get.on('timeout', () => { get.destroy(); reject(new Error('代理请求超时')); });
          get.on('error', reject);
          get.end();
        });
        tlsSock.on('error', reject);
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('代理 CONNECT 超时')); });
      req.on('error', reject);
      req.end();
    }).catch(reject);
  });
}
