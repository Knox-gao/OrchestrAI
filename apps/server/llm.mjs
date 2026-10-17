/**
 * Model Gateway：统一的 LLM 调用层（P4）。
 * 支持 智谱 GLM / OpenAI / 自定义 OpenAI 兼容网关（用户在 🔑 面板自行配置地址与 Key）。
 * 所有调用有超时与明确失败状态——失败时上层回退规则识别，绝不阻塞生成。
 */
import { getKey, getKeys, inferModel } from './keys.mjs';

const TIMEOUT = 45_000;

/** 从已配置的 Key 中挑选可用网关（优先级：zhipu > openai > 自定义第一个） */
export function pickGateway(preference = 'auto') {
  const all = getKeys();
  if (preference === 'rule') return null; // 用户强制规则识别
  const mk = {
    zhipu: (k) => ({ provider: 'zhipu', key: k, model: 'glm-5.3-flash', defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4' }),
    openai: (k) => ({ provider: 'openai', key: k, model: 'gpt-4o-mini', defaultBaseUrl: 'https://api.openai.com/v1' }),
  };
  // 指定内置供应商：仅用指定的（未配置则返回 null，上层明确报告）
  if (preference === 'zhipu' || preference === 'openai') {
    const key = all[preference];
    return key ? mk[preference](key) : null;
  }
  if (preference.startsWith('custom:')) {
    const id = preference.slice(7);
    const custom = (all.custom ?? []).find((c) => c.id === id);
    if (custom?.baseUrl) return { provider: 'custom', key: custom.key, model: custom.model ?? inferModel(custom.baseUrl), defaultBaseUrl: custom.baseUrl, label: custom.label };
    return null;
  }
  // auto：内置优先，其次自定义第一个
  if (all.zhipu) return mk.zhipu(all.zhipu);
  if (all.openai) return mk.openai(all.openai);
  const custom = (all.custom ?? [])[0];
  if (custom?.baseUrl) return { provider: 'custom', key: custom.key, model: custom.model ?? inferModel(custom.baseUrl), defaultBaseUrl: custom.baseUrl, label: custom.label };
  return null;
}

function endpoint(gw) {
  const base = (gw.baseUrl ?? gw.defaultBaseUrl ?? '').replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(base)) return base;
  return `${base}/chat/completions`;
}

/** OpenAI 兼容 chat completions。返回 assistant 文本；任何失败抛错。 */
export async function chat(gw, messages, { temperature = 0.3, maxTokens = 1200, webSearch = false } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(endpoint(gw), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gw.key}` },
      body: JSON.stringify({
        model: gw.model, messages, temperature, max_tokens: maxTokens,
        // glm-5.3 系列为思考模型：关闭思考保证小预算下 content 非空
        ...(gw.provider === 'zhipu' ? { thinking: { type: 'disabled' } } : {}),
        // 默认联网（智谱 web_search 工具）：产品参数等可查证真实资料
        ...(webSearch && gw.provider === 'zhipu' ? { tools: [{ type: 'web_search', web_search: { enable: true, search_result: false } }] } : {}),
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`LLM HTTP ${res.status} ${body.slice(0, 120)}`);
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('LLM 返回为空');
    return text;
  } finally {
    clearTimeout(t);
  }
}

/** 截断 JSON 修复：补引号 → 剥残缺成员 → 补闭合括号 */
function repairTruncatedJson(src) {
  // 1) 补未闭合字符串的引号
  let inStr = false;
  let esc = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { if (inStr) esc = true; continue; }
    if (ch === '"') inStr = !inStr;
  }
  let out = inStr ? src + '"' : src;
  // 2) 反复剥掉尾部残缺成员（悬空 "key": / 裸 "key" / 逗号冒号）
  for (;;) {
    const before = out;
    out = out
      .replace(/,\s*"[^"]*"\s*:\s*$/, '')  // ,"key": （键无值）
      .replace(/,\s*"[^"]*"\s*$/, '')      // ,"key"   （裸键）
      .replace(/[,:]\s*$/, '')             // 悬空 , 或 :
      .replace(/"[^"]*"\s*:\s*$/, '')      // "key": （首个键无值，对象开头）
      .trim();
    if (out === before) break;
  }
  // 3) 扫描括号栈补齐
  const st = [];
  let s2 = false;
  let e2 = false;
  for (let i = 0; i < out.length; i++) {
    const ch = out[i];
    if (e2) { e2 = false; continue; }
    if (ch === '\\') { if (s2) e2 = true; continue; }
    if (ch === '"') { s2 = !s2; continue; }
    if (s2) continue;
    if (ch === '{' || ch === '[') st.push(ch);
    else if (ch === '}' || ch === ']') st.pop();
  }
  if (s2) out += '"';
  while (st.length) out += st.pop() === '{' ? '}' : ']';
  return out;
}

/** 从 LLM 回复中容错提取 JSON 对象（容忍 ```json 包裹、前后闲话、与截断） */
export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  if (start < 0) throw new Error('回复中未找到 JSON');
  const end = candidate.lastIndexOf('}');
  const raw = end > start ? candidate.slice(start, end + 1) : candidate.slice(start);
  try {
    return JSON.parse(raw);
  } catch {
    // 截断容错：补齐括号再试
    const whole = candidate.slice(start);
    try {
      return JSON.parse(repairTruncatedJson(whole));
    } catch (e1) {
      // 二次修复：逐级回退到最后一个完整对象边界，剥残缺元素后闭合（数组中段截断的典型形态）
      let cut = whole.length;
      while (cut > 200) {
        cut = whole.lastIndexOf('}', cut - 1);
        if (cut <= 200) break;
        for (const frag of [whole.slice(0, cut + 1), whole.slice(0, cut + 1).replace(/,\s*$/, '')]) {
          try { return JSON.parse(repairTruncatedJson(frag)); } catch { /* 继续回退 */ }
        }
      }
      throw new Error(`JSON 解析失败（含截断修复尝试）：${String(e1?.message ?? e1).slice(0, 80)}`);
    }
  }
}
