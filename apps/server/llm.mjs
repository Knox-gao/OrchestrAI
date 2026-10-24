/**
 * Model Gateway：统一的 LLM 调用层（P4）。
 * 支持 智谱 GLM / OpenAI / 自定义 OpenAI 兼容网关（用户在 🔑 面板自行配置地址与 Key）。
 * 所有调用有超时与明确失败状态——失败时上层回退规则识别，绝不阻塞生成。
 */
import { getKey, getKeys, inferModel } from './keys.mjs';

/**
 * M7-B4E 根因修复。
 *
 * 真实故障（项目 PMVLZKTF7）：PagePlan 两次尝试均以 "This operation was aborted" 失败，
 * 实际总耗时 90.0s = 2 × 45s，精确等于本文件原来写死的 TIMEOUT。
 * 也就是说：不是网络抖动，而是**超时预算与请求工作量不匹配**——
 * PagePlan 请求 maxTokens=10000（默认文本请求只有 1200），10k tokens 的结构化 JSON
 * 在推理模型上远不止 45 秒。两次请求都在 45s 被 abort，重试注定同样失败。
 *
 * 修复原则（不违反"禁止单纯加大 timeout / 删除 AbortController / 伪造成功"）：
 *   1. 超时预算**由 maxTokens 推导**，而不是一个与工作量无关的常数；
 *   2. 小请求（≤ 历史默认 1200 tokens）行为保持不变（仍是 45s），避免改变既有语义；
 *   3. 超时与外部取消**分类区分**，各自带上可重试标志；
 *   4. 允许环境变量覆盖，便于现场按供应商实测延迟调参，而不是改代码。
 */
export const LLM_TIMEOUT_FLOOR_MS = 45_000;
/** 每个输出 token 预留的生成时间（毫秒）。10k tokens → 250s；1.2k tokens 仍取 45s 下限。 */
export const LLM_TIMEOUT_PER_TOKEN_MS = 25;

/**
 * 由 maxTokens 推导超时预算。
 * 环境变量 ORCHESTRAI_LLM_TIMEOUT_MS 优先（便于现场调参）。
 */
export function timeoutFor(maxTokens) {
  const env = Number(process.env.ORCHESTRAI_LLM_TIMEOUT_MS);
  if (Number.isFinite(env) && env > 0) return Math.floor(env);
  const tokens = Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 0;
  return Math.max(LLM_TIMEOUT_FLOOR_MS, Math.ceil(tokens * LLM_TIMEOUT_PER_TOKEN_MS));
}

/**
 * 是否为"推理型"模型（会把 max_tokens 消耗在 reasoning_content 上）。
 *
 * 实测证据（deepseek-flash + 真实 PagePlan payload）：
 *   - 默认：completion=9999/10000 全部用满，其中 reasoning=4645，content 被截断或为空；
 *   - 关闭 thinking：completion=3881，finish=stop，content 完整。
 *
 * 只在**已知**推理模型上发送 thinking:disabled；其余网关保持原样，
 * 避免把不支持的参数发给严格校验的 OpenAI 兼容服务（会 400）。
 * 可用 ORCHESTRAI_DISABLE_THINKING=on/off 强制开关。
 */
export function shouldDisableThinking(gw) {
  const env = String(process.env.ORCHESTRAI_DISABLE_THINKING ?? '').toLowerCase();
  if (env === 'on' || env === '1' || env === 'true') return true;
  if (env === 'off' || env === '0' || env === 'false') return false;
  const model = String(gw?.model ?? '').toLowerCase();
  return /deepseek|glm|qwen|qwq|o1|o3|o4|reason|thinking|r1/.test(model);
}

/**
 * 安全化任意字符串，供错误信息/日志/API 响应使用。
 *
 * 为什么需要（发布前审计发现的两个高危项）：
 *   1. `/api/jobs/:id` 曾直接返回 errorStack —— 栈里可能带上游 URL、请求参数；
 *   2. 上游 HTTP 错误体曾截取 120 字符回显 —— 供应商常把 api key 片段、
 *      request id、甚至整个 Authorization 回显在 error body 里。
 *
 * 这里做的是**出口统一收口**：凡是可能来自网络的文本，都必须先过这个函数。
 */
export function sanitizeForOutput(input, maxLen = 300) {
  let s = String(input ?? '');
  // Authorization / Bearer
  s = s.replace(/(Bearer\s+)[A-Za-z0-9._\-+/=]{6,}/gi, '$1[REDACTED]');
  // 常见厂商 key 形态
  s = s.replace(/\bsk-[A-Za-z0-9._\-]{6,}/g, 'sk-[REDACTED]');
  s = s.replace(/\b(?:sk|pk|api[_-]?key|apikey)[_-][A-Za-z0-9._\-]{10,}/gi, '[REDACTED_KEY]');
  // URL 查询参数中的敏感项
  s = s.replace(/([?&](?:key|api_key|apikey|access_token|token|secret|password)=)[^&\s"'<>]+/gi, '$1[REDACTED]');
  // URL 里的 user:pass@host
  s = s.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1[REDACTED]@');
  // JSON 风格的 "apiKey":"xxx" / "authorization":"xxx" / "access_token":"xxx"
  s = s.replace(/("(?:api[-_]?key|authorization|access[-_]?token|refresh[-_]?token|id[-_]?token|token|secret|password)"\s*:\s*")[^"]{4,}(")/gi, '$1[REDACTED]$2');
  // 绝对路径（发布版不应把构建机路径吐给用户）。
  // 必须先排除 URL 的 scheme 部分，否则 `https://` 会被误当成 `s:/` 盘符路径。
  s = s.replace(/(?<![A-Za-z0-9+.-])[A-Za-z]:[\\/](?![\\/])[^\s"'<>]{3,}/g, '[local-path]');
  if (s.length > maxLen) s = `${s.slice(0, maxLen)}…`;
  return s;
}

/** 已分类的模型层错误。code 是稳定标识，供上层做重试决策。 */
export class LLMError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LLMError';
    this.code = code;
    this.classification = details.classification ?? null;
    this.retryable = details.retryable === true;
    this.details = details;
  }
}

/** 从任意错误里安全地提取分类信息（不含密钥/URL 查询参数）。 */
function classifyFetchError(error, { timedOut, elapsedMs, enteredNetwork }) {
  const name = String(error?.name ?? 'Error');
  const isAbort = name === 'AbortError' || error?.code === 20 || /aborted/i.test(String(error?.message ?? ''));
  if (timedOut) {
    return new LLMError('LLM_TIMEOUT', `模型请求超时（${elapsedMs}ms）：供应商未在该预算内返回`, {
      classification: 'A_single_request_timeout', retryable: true, timedOut: true, elapsedMs, enteredNetwork, errorName: name,
    });
  }
  if (isAbort) {
    return new LLMError('LLM_ABORTED', '模型请求被中止（非超时原因）', {
      classification: 'B_or_C_external_cancel', retryable: false, timedOut: false, elapsedMs, enteredNetwork, errorName: name,
    });
  }
  // 其余（网络中断等）保留原始信息，由上层决定
  return error;
}

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

/**
 * 统一的请求实现（chat 与 chatDetailed 共用，避免两处逻辑漂移）。
 *
 * AbortSignal 生命周期（M7-B4E 逐点确认）：
 *   - 每次调用**新建** AbortController，绝不跨调用共享；
 *   - 超时由**本次调用**的 maxTokens 推导（timeoutFor），不是全局常数；
 *   - 调用方可通过 externalSignal 传入"外部取消"（父任务撤销），此时中止被分类为 LLM_ABORTED 且不可重试；
 *   - finally 里一定 clearTimeout，不会留下请求结束后仍触发的定时器。
 */
async function requestChat(gw, messages, { temperature = 0.3, maxTokens = 1200, webSearch = false, timeoutMs, externalSignal } = {}) {
  // 1) 每次调用独立的请求级控制器
  const ctrl = new AbortController();
  const budgetMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : timeoutFor(maxTokens);

  let abortCause = null;          // 'timeout' | 'external'
  let enteredNetwork = false;
  const startedAt = Date.now();

  // 注意：这里**不传 abort(reason)**。
  // 因为 fetch 在 signal 携带 reason 时抛出的是 reason 本身（普通 Error），
  // 会丢失标准的 AbortError 语义，导致下游无法按 name/code 分类。
  // 原因区分完全依赖 abortCause 变量，不依赖异常内容。
  const timer = setTimeout(() => {
    abortCause = 'timeout';
    ctrl.abort();
  }, budgetMs);

  // 外部取消（父任务撤销）：与超时区分开
  const onExternalAbort = () => {
    if (ctrl.signal.aborted) return;
    abortCause = 'external';
    ctrl.abort();
  };
  if (externalSignal) {
    if (externalSignal.aborted) onExternalAbort();
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    enteredNetwork = true;
    const res = await fetch(endpoint(gw), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gw.key}` },
      body: JSON.stringify({
        model: gw.model, messages, temperature, max_tokens: maxTokens,
        // glm-5.3 系列为思考模型：关闭思考保证小预算下 content 非空
        ...(gw.provider === 'zhipu' ? { thinking: { type: 'disabled' } } : {}),
        // M7-B4E：deepseek 等推理模型会把 max_tokens 全部消耗在 reasoning_content 上，
        // 导致 content 为空且 finish_reason='length'（实测：10000 tokens 全部计入 reasoning）。
        // 对自定义网关尝试关闭 thinking；不支持该参数的供应商会忽略它。
        ...(gw.provider !== 'zhipu' && shouldDisableThinking(gw) ? { thinking: { type: 'disabled' } } : {}),
        // 默认联网（智谱 web_search 工具）：产品参数等可查证真实资料
        ...(webSearch && gw.provider === 'zhipu' ? { tools: [{ type: 'web_search', web_search: { enable: true, search_result: false } }] } : {}),
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      // 上游错误体不可直接回显：供应商常在 error body 里回显 key 片段/请求 id/整个请求头。
      // 只保留状态码 + 脱敏后的短摘要；剩余细节仅作为内部 diagnostic 字段（不进 API 响应）。
      const raw = await res.text().catch(() => '');
      const safe = sanitizeForOutput(raw, 160);
      const err = new LLMError('LLM_HTTP_ERROR', `模型网关返回 HTTP ${res.status}${safe ? `：${safe}` : ''}`, {
        classification: res.status === 429 ? 'D_rate_limited' : (res.status >= 500 ? 'E_upstream_error' : 'F_request_rejected'),
        retryable: res.status === 429 || res.status >= 500,
        httpStatus: res.status,
      });
      throw err;
    }
    const data = await res.json();
    const choice = data?.choices?.[0];
    const text = choice?.message?.content;
    const reasoning = choice?.message?.reasoning_content;
    const finishReason = choice?.finish_reason;
    const usage = data?.usage ?? null;

    // M7-B4E：空 content 有多种原因，必须区分，否则只会得到一句"LLM 返回为空"。
    // 最常见的两种：
    //   (a) finish_reason='length' 且 reasoning_tokens 用满 → 推理吃光了 max_tokens；
    //   (b) 供应商返回了 reasoning_content 但没有 content → 思考未收敛。
    if (typeof text !== 'string' || !text.trim()) {
      const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens ?? null;
      const completionTokens = usage?.completion_tokens ?? null;
      const base = { finishReason, reasoningTokens, completionTokens, maxTokens, hasReasoningText: typeof reasoning === 'string' && reasoning.length > 0 };
      if (finishReason === 'length') {
        throw new LLMError('LLM_OUTPUT_TRUNCATED',
          `模型输出被 max_tokens 截断且未产出正文（finish=length，completion=${completionTokens ?? '?'}/${maxTokens}${reasoningTokens != null ? `，其中推理 ${reasoningTokens}` : ''}）。这说明 token 预算被思考过程耗尽，需要提高 max_tokens 或关闭 thinking。`,
          { classification: 'A2_output_budget_exhausted', retryable: true, ...base });
      }
      throw new LLMError('LLM_EMPTY_CONTENT',
        `模型返回空内容（finish=${finishReason ?? 'unknown'}，completion=${completionTokens ?? '?'}${reasoningTokens != null ? `，推理 ${reasoningTokens}` : ''}）`,
        { classification: 'A3_empty_content', retryable: true, ...base });
    }
    return { text, usage, elapsedMs: Date.now() - startedAt, budgetMs, finishReason, reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? null };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    // 已经分类过的错误（例如内部抛的 HTTP 错误不再包装）
    if (error instanceof LLMError) throw error;
    // 只有"确实因为 abort 而失败"才走分类，HTTP/解析错误原样上抛
    if (abortCause || error?.name === 'AbortError' || error?.code === 20) {
      throw classifyFetchError(error, {
        // 只有明确由**本函数定时器**触发才算超时；其余 abort 一律算外部取消
        timedOut: abortCause === 'timeout',
        elapsedMs,
        enteredNetwork,
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      try { externalSignal.removeEventListener('abort', onExternalAbort); } catch { /* 忽略 */ }
    }
  }
}

/** OpenAI 兼容 chat completions。返回 assistant 文本；任何失败抛错。 */
export async function chat(gw, messages, options = {}) {
  const r = await requestChat(gw, messages, options);
  return r.text;
}

/**
 * 与 chat() 相同，但同时返回供应商原始 usage（如提供）。
 * 为什么需要：chat() 历史上只返回 assistant 文本，把响应体里的 usage 丢掉了，
 * 导致上层永远只能写 usage:null。要"只用供应商真实值"就必须在适配器层把它带出来。
 * 不猜测：供应商没给 usage 时记为 null，由上层标 unavailable。
 */
export async function chatDetailed(gw, messages, options = {}) {
  const r = await requestChat(gw, messages, options);
  return { text: r.text, usage: r.usage ?? null };
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
