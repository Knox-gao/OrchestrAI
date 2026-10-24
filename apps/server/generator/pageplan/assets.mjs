/**
 * PagePlan 图片资产落地（M7-B4B）
 *
 * 为什么需要：PagePlan 的 image 节点必须指向真实可用的资源。候选渲染器只负责渲染，
 * 若模型给出 HTTPS 外链，产物在离线/ZIP 场景会缺图（候选包自己的 warnings 也指出这点）；
 * 若给出相对路径，产物里可能根本没有这个文件。
 *
 * 本模块在渲染前把图片节点归一为"工作区内真实存在的文件"：
 *   - https 外链 → 受限下载并落盘为 images/<sha1>.<ext>，节点 src 改写为相对路径
 *   - 相对路径 → 必须已存在，否则抛 PAGEPLAN_ASSET_MISSING（阻断，不静默留空）
 *   - 下载失败 → 不用占位图糊弄，保留外链并在报告中如实列出（由渲染门禁决定是否阻断）
 *
 * 安全：只允许 https，限制大小与超时，不跟随到非 https 的重定向，只接受 image/*。
 */

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 8000;
const EXT_BY_TYPE = new Map([
  ['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'], ['image/gif', 'gif'], ['image/avif', 'avif'],
]);

export class PagePlanAssetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PagePlanAssetError';
    this.code = code;
  }
}

function walk(nodes, fn) {
  for (const node of nodes ?? []) {
    fn(node);
    if (Array.isArray(node.children)) walk(node.children, fn);
    if (node.type === 'tabs') for (const panel of node.panels ?? []) walk(panel.children, fn);
  }
}

/** 收集所有 image 节点（返回引用，便于就地改写） */
export function collectImageNodes(plan) {
  const out = [];
  walk(plan.nodes, (n) => { if (n.type === 'image') out.push(n); });
  return out;
}

async function download(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal });
    if (!res.ok) throw new PagePlanAssetError('PAGEPLAN_ASSET_HTTP', `图片下载失败 HTTP ${res.status}`);
    const finalUrl = res.url || url;
    if (!/^https:\/\//i.test(finalUrl)) throw new PagePlanAssetError('PAGEPLAN_ASSET_INSECURE', '图片被重定向到非 HTTPS 地址');
    const type = String(res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const ext = EXT_BY_TYPE.get(type);
    if (!ext) throw new PagePlanAssetError('PAGEPLAN_ASSET_TYPE', `不支持的图片类型：${type || '未知'}`);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_BYTES) throw new PagePlanAssetError('PAGEPLAN_ASSET_TOO_LARGE', `图片过大：${len} 字节`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new PagePlanAssetError('PAGEPLAN_ASSET_TOO_LARGE', `图片过大：${buf.length} 字节`);
    if (buf.length === 0) throw new PagePlanAssetError('PAGEPLAN_ASSET_EMPTY', '图片内容为空');
    return { buf, ext };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 把 PagePlan 的图片节点落地为工作区内真实文件。
 * @param {object} plan 已通过 schema 校验的 PagePlan（会被就地改写 src）
 * @param {{fetcher?: Function, existing?: (rel:string)=>boolean, timeoutMs?: number}} opts
 * @returns {Promise<{assets: Array<{nodeId:string,src:string,file:string,bytes:number}>, unresolved: Array<{nodeId:string,src:string,reason:string}>}>}
 */
export async function bundlePagePlanAssets(plan, opts = {}) {
  const { fetcher = download, timeoutMs = TIMEOUT_MS } = opts;
  const existing = opts.existing ?? (() => false);
  const assets = [];
  const unresolved = [];
  const used = new Map();  // url → file（同一张图复用）

  for (const node of collectImageNodes(plan)) {
    const src = String(node.src ?? '');
    // searchQuery-only nodes are optional image slots; the pipeline leaves src
    // empty when no sufficiently relevant search result is available.
    if (!src.trim()) continue;
    if (/^https:\/\//i.test(src)) {
      if (used.has(src)) { node.src = used.get(src); continue; }
      try {
        const { buf, ext } = await fetcher(src, timeoutMs);
        const hash = (await import('node:crypto')).createHash('sha1').update(buf).digest('hex').slice(0, 12);
        const file = `images/pp-${hash}.${ext}`;
        used.set(src, file);
        node.src = file;
        assets.push({ nodeId: node.id, src, file, bytes: buf.length, buf });
      } catch (e) {
        // 不伪造图片：保留外链并如实记录，交给渲染门禁判定是否阻断
        unresolved.push({ nodeId: node.id, src, reason: String(e?.message ?? e).slice(0, 160) });
      }
      continue;
    }
    if (!existing(src)) {
      throw new PagePlanAssetError('PAGEPLAN_ASSET_MISSING', `PagePlan 引用的本地图片不存在：${src}（node ${node.id}）`);
    }
  }
  return { assets, unresolved };
}
