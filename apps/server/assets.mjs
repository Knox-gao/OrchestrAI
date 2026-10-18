/**
 * 图片资产注册表（阶段一最小实现）：按项目名跨工作区的来源追溯 + 锁定复用
 * 背景：每次生成创建新工作区（P+时间戳），资产清单必须按"项目名"放注册表才能跨重生成复用。
 * 目标：同一项目重新生成时，已确认（locked）且源文件 sha1 一致的图片直接复用，不再重新采集。
 * 事实源：workspaces/_assets/<项目名>.json（entries 含来源工作区/许可/理由/sha1/时间/锁定位）。
 * 开关：环境变量 ORCHESTRAI_IMAGE_LOCK=off 时 pipeline 不复用不落锁（回滚通道）。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ASSET_REGISTRY = path.join(ROOT, 'workspaces', '_assets');

const safeName = (name) => String(name ?? 'app').replace(/[^\w\u4e00-\u9fff-]+/g, '_').slice(0, 48) || 'app';

export function hashBuf(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

export function loadAssets(projectName) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(ASSET_REGISTRY, safeName(projectName) + '.json'), 'utf8'));
    if (d && Array.isArray(d.entries)) return d;
  } catch { /* 无清单视为空 */ }
  return { version: 1, entries: [] };
}

export function saveAssets(projectName, assets) {
  fs.mkdirSync(ASSET_REGISTRY, { recursive: true });
  fs.writeFileSync(path.join(ASSET_REGISTRY, safeName(projectName) + '.json'), JSON.stringify(assets, null, 1));
}

/** 采集结果 → 资产条目（src=来源工作区相对路径，供跨工作区复用读取） */
export function assetEntry(img, { reason = '', provider = '', srcWs = '', slotKey = '', en = '' } = {}) {
  return {
    file: img.file,
    src: srcWs ? path.join(srcWs, img.file).replaceAll('\\', '/') : img.file,
    title: img.title ?? '',
    slotKey: slotKey || slotKeyOf(img.title),
    en: en || '',
    sub: img.sub ?? '',
    author: img.author ?? '',
    license: img.license ?? '',
    page: img.page ?? '',
    sha1: hashBuf(img.buf),
    bytes: img.buf.length,
    provider,
    reason,
    locked: true,
    chosenAt: new Date().toISOString(),
  };
}

/** 图位 key：展示名归一化（去空白/大小写） */
export function slotKeyOf(name) {
  return String(name ?? '').trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * 图位解析（语义角色判定）：
 *   - 名称精确相同 → 同图位（复用候选）
 *   - 名称不同但英文标识相同（如"雷神托尔"→"雷神"，en 都是 Thor）→ 同图位
 *   - 英文标识都存在且不同 → 语义角色已实质变化 → 不得复用（status: semantic-change）
 *   - 源文件丢失 / sha1 不符 → 明确状态，不静默换图
 * @returns {{status:'reuse'|'source-missing'|'hash-mismatch'|'semantic-change'|'no-match', img?:Object}}
 */
export function resolveSlot(assets, item) {
  const key = slotKeyOf(item.name);
  const en = String(item.en ?? '').trim().toLowerCase();
  const entries = assets.entries ?? [];
  let prev = entries.find((e) => slotKeyOf(e.title) === key);
  if (!prev && en) prev = entries.find((e) => e.en && e.en === en && e.locked);
  if (!prev) return { status: 'no-match' };
  if (en && prev.en && prev.en !== en) return { status: 'semantic-change', prev };
  if (!prev.locked) return { status: 'no-match' };
  const fp = path.join(ROOT, 'workspaces', prev.src);
  if (!fs.existsSync(fp)) return { status: 'source-missing', prev };
  let buf;
  try { buf = fs.readFileSync(fp); } catch { return { status: 'source-missing', prev }; }
  if (hashBuf(buf) !== prev.sha1) return { status: 'hash-mismatch', prev };
  return {
    status: 'reuse',
    img: { file: prev.file, title: prev.title, sub: prev.sub ?? '', desc: prev.desc ?? item.desc ?? '', author: prev.author, license: prev.license, page: prev.page, buf, reused: true },
  };
}

/** 兼容保留：旧签名（按对象名复用） */
export function reusableAsset(assets, objectName) {
  const r = resolveSlot(assets, { name: objectName });
  return r.status === 'reuse' ? r.img : null;
}
