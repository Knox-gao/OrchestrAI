/**
 * 用户自带 API Key 的安全存储。
 * - 明文只存本地 apps/server/keys.json（已 gitignore）
 * - 对外接口只返回掩码（前 4 位 + ***）
 * - 不写入日志 / 事件 / 导出 ZIP
 * - ORCHESTRAI_KEYS_FILE 可重定向到隔离路径（E2E/交接验收用，禁止读取正式库）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = process.env.ORCHESTRAI_KEYS_FILE
  ? path.resolve(process.env.ORCHESTRAI_KEYS_FILE)
  : path.join(path.dirname(fileURLToPath(import.meta.url)), 'keys.json');

export const KEYS_FILE = FILE;

export const PROVIDERS = [
  { id: 'pexels', label: 'Pexels', purpose: '高质量图库照片（生成展馆/图库时优先使用）', url: 'https://www.pexels.com/api/' },
  { id: 'unsplash', label: 'Unsplash', purpose: '高质量图库照片（备选图源）', url: 'https://unsplash.com/developers' },
  { id: 'zhipu', label: '智谱 GLM', purpose: '大模型生成（P4 受约束代码生成，预留）', url: 'https://open.bigmodel.cn' },
  { id: 'openai', label: 'OpenAI', purpose: '大模型生成（预留）', url: 'https://platform.openai.com' },
  { id: 'anthropic', label: 'Anthropic', purpose: '大模型生成（预留）', url: 'https://console.anthropic.com' },
];

function readAll() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf-8')); } catch { return {}; }
}

export function getKeys() { return readAll(); }

export function getKey(provider) { return readAll()[provider] ?? null; }

export function setKey(provider, key) {
  if (!PROVIDERS.some((p) => p.id === provider)) throw new Error(`unknown provider: ${provider}`);
  const all = readAll();
  const trimmed = String(key ?? '').trim();
  if (!trimmed) throw new Error('key required');
  all[provider] = trimmed;
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2));
  return mask(all[provider]);
}

export function deleteKey(provider) {
  const all = readAll();
  delete all[provider];
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2));
}

/* ---------- 自定义服务（任意 OpenAI 兼容网关 / 自建服务） ---------- */

/** 按网关地址推断默认模型名 */
export function inferModel(baseUrl) {
  const u = String(baseUrl ?? '').toLowerCase();
  if (u.includes('deepseek')) return 'deepseek-flash';
  if (u.includes('bigmodel') || u.includes('zhipu')) return 'glm-4-flash';
  if (u.includes('moonshot')) return 'moonshot-v1-8k';
  if (u.includes('qwen') || u.includes('dashscope')) return 'qwen-turbo';
  return 'gpt-4o-mini';
}

export function addCustom({ label, baseUrl, key, model }) {
  const name = String(label ?? '').trim().slice(0, 30);
  const url = String(baseUrl ?? '').trim();
  const k = String(key ?? '').trim();
  if (!name) throw new Error('名称不能为空');
  if (!/^https?:\/\//.test(url)) throw new Error('地址需以 http(s):// 开头');
  if (!k) throw new Error('Key 不能为空');
  const m = String(model ?? '').trim() || inferModel(url);
  const all = readAll();
  all.custom = all.custom ?? [];
  const item = { id: 'c' + Date.now().toString(36), label: name, baseUrl: url, key: k, model: m };
  all.custom.push(item);
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2));
  return { id: item.id, label: name, baseUrl: url, model: m, masked: mask(k) };
}

export function removeCustom(id) {
  const all = readAll();
  all.custom = (all.custom ?? []).filter((c) => c.id !== id);
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2));
}

export function mask(key) {
  if (!key) return null;
  return key.length <= 8 ? '***' : `${key.slice(0, 4)}***${key.slice(-2)}`;
}

/** 掩码视图（给前端） */
export function maskedKeys() {
  const all = readAll();
  const builtin = PROVIDERS.map((p) => ({
    id: p.id, label: p.label, purpose: p.purpose, url: p.url,
    masked: mask(all[p.id]) ?? null, configured: Boolean(all[p.id]), custom: false,
  }));
  const customs = (all.custom ?? []).map((c) => ({
    id: c.id, label: c.label, purpose: `${c.baseUrl} · ${c.model ?? inferModel(c.baseUrl)}`, url: '',
    masked: mask(c.key) ?? null, configured: true, custom: true, model: c.model ?? inferModel(c.baseUrl),
  }));
  return [...builtin, ...customs];
}


/** 更新自定义网关的模型名 */
export function setCustomModel(id, model) {
  const all = readAll();
  const item = (all.custom ?? []).find((c) => c.id === id);
  if (!item) throw new Error('自定义服务不存在');
  item.model = String(model ?? '').trim() || inferModel(item.baseUrl);
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2));
  return item.model;
}
