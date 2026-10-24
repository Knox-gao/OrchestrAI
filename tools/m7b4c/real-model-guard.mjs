/**
 * M7-B4D 真实模型验收：安全守卫（纯函数，可单测）
 *
 * 为什么单独拆出来：验收入口一旦跑起来就是"真实花钱 + 真实发请求"，
 * 它必须能被**不联网、不读密钥**地测试。所以授权判定、请求预算、脱敏、
 * 失败分类、证据目录唯一性全部做成纯函数放在这里。
 *
 * 审计依据：M7-B4D 任务书任务 A 的 10 个问题。
 */

export const PROTOCOL_VERSION = 'm7b4d-real-model.v1';

/** 每主题最多 2 次请求 = 1 次首请求 + 1 次重试（与 generate.mjs 的 maxAttempts 对齐）。 */
export const MAX_REQUESTS_PER_THEME = 2;

/** 三个既有主题 + 一个未参与 prompt 调参的保留主题（本阶段只登记，不执行）。 */
export const REQUIRED_THEMES = Object.freeze(['island', 'village', 'dome']);
export const HELD_OUT_THEME = 'lantern-market';

/**
 * 解析 CLI 参数。授权必须显式；授权后模型标识也必须显式（不允许隐式 'auto'，
 * 那会让"我以为在用 A 模型，实际用了默认网关"成为可能）。
 *
 * @returns {{authorized:boolean, llm:string|null, dryRun:boolean, errors:string[]}}
 */
export function parseInvocationArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const errors = [];
  const authorized = args.includes('--authorized');
  const dryRun = args.includes('--dry-run') || !authorized;

  let llm = null;
  const i = args.indexOf('--llm');
  if (i >= 0) {
    const v = args[i + 1];
    if (typeof v !== 'string' || !v.trim() || v.startsWith('--')) errors.push('--llm 之后必须紧跟模型标识，例如 custom:my-gw 或 zhipu:glm-4');
    else llm = v.trim();
  }

  if (authorized && !llm) errors.push('已授权但未指定 --llm：拒绝使用隐式 auto 网关（避免误用未预期供应商）');

  return { authorized, llm, dryRun: dryRun || errors.length > 0, errors };
}

/**
 * 深度脱敏：只针对**敏感键名**做替换，不碰正常内容。
 * 覆盖 Authorization 头、api key、bearer token、URL 查询参数里的 key/token。
 *
 * 注意：这里不是"尽力而为"，而是"宁可多删"——验收证据宁可少一点也不能带密钥。
 */
const SENSITIVE_KEY_RE = /^(api[-_]?key|apikey|key|secret|authorization|auth|token|access[-_]?token|refresh[-_]?token|password|passwd|credential|credentials|cookie|set-cookie)$/i;

export function redactSecrets(value, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, seen));

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(k)) {
      out[k] = typeof v === 'string' && v.length > 0 ? '[REDACTED]' : (v == null ? v : '[REDACTED]');
      continue;
    }
    out[k] = redactSecrets(v, seen);
  }
  return out;
}

/** 字符串级脱敏：Bearer 头、sk- 前缀、URL 里的敏感查询参数、user:pass@host。 */
export function redactString(text) {
  if (typeof text !== 'string') return text;
  return text
    // Authorization: Bearer xxx
    .replace(/(Bearer\s+)[A-Za-z0-9._\-+/=]{8,}/gi, '$1[REDACTED]')
    // 常见厂商 key 形态
    .replace(/\bsk-[A-Za-z0-9._\-]{8,}/g, 'sk-[REDACTED]')
    .replace(/\b(sk|pk|api[_-]?key)[_-][A-Za-z0-9._\-]{12,}/gi, '$1_[REDACTED]')
    // URL 查询参数中的敏感项
    .replace(/([?&](?:key|api_key|apikey|access_token|token|secret)=)[^&\s"']+/gi, '$1[REDACTED]')
    // user:pass@host
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1[REDACTED]@');
}

/**
 * 请求预算守卫：每主题、以及全局都不能超。
 * 超了就抛错，而不是"继续发"。
 */
export function assertRequestBudget(counts, themeKey, { perTheme = MAX_REQUESTS_PER_THEME, totalLimit = null } = {}) {
  const used = Number(counts?.[themeKey] ?? 0);
  if (used >= perTheme) {
    const err = new Error(`主题 ${themeKey} 已达请求上限 ${perTheme}，拒绝继续请求`);
    err.code = 'REQUEST_BUDGET_EXCEEDED';
    err.themeKey = themeKey;
    throw err;
  }
  if (totalLimit != null) {
    const total = Object.values(counts ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
    if (total >= totalLimit) {
      const err = new Error(`全局请求数已达 ${totalLimit}，拒绝继续请求`);
      err.code = 'GLOBAL_BUDGET_EXCEEDED';
      throw err;
    }
  }
  return true;
}

/**
 * 失败分类：把"失败了"拆成可追踪的类别，避免只留一句 reason。
 * retryable=true 的才允许发第二次请求。
 */
export function classifyFailure({ status, failed, blocked, reason, error } = {}) {
  const text = String(reason ?? error ?? '');
  if (status === 'done' && failed === false) return { category: 'delivered', retryable: false, detail: '' };

  if (blocked === 'pageplan_failed') {
    // PagePlan 生成失败又分：模型没给 JSON / JSON 非法 / schema 不过 / blocking unsupported
    if (/MODEL_NOT_JSON|MODEL_INVALID_JSON|MODEL_EMPTY/i.test(text)) return { category: 'invalid_json', retryable: true, detail: text.slice(0, 200) };
    if (/PAGEPLAN_BLOCKED|blocking/i.test(text)) return { category: 'model_declared_blocking', retryable: false, detail: text.slice(0, 200) };
    if (/PAGEPLAN_CAPABILITY_UNAVAILABLE|capability/i.test(text)) return { category: 'capability_unavailable', retryable: false, detail: text.slice(0, 200) };
    if (/PAGEPLAN_ASSET_MISSING|ASSET/i.test(text)) return { category: 'asset_missing', retryable: false, detail: text.slice(0, 200) };
    return { category: 'pageplan_failed_other', retryable: true, detail: text.slice(0, 200) };
  }
  if (blocked === 'scene_brief_mismatch') return { category: 'brief_mismatch', retryable: false, detail: text.slice(0, 200) };
  if (blocked === 'asset_unresolved') return { category: 'asset_unresolved', retryable: false, detail: text.slice(0, 200) };
  if (blocked === 'required_coverage_blocked') return { category: 'required_coverage', retryable: false, detail: text.slice(0, 200) };
  if (blocked === 'model_required') return { category: 'no_model_configured', retryable: false, detail: text.slice(0, 200) };
  if (failed === true) return { category: 'failed_other', retryable: false, detail: text.slice(0, 200) };
  if (status === 'error') return { category: 'job_error', retryable: true, detail: text.slice(0, 200) };
  return { category: 'unknown', retryable: false, detail: text.slice(0, 200) };
}

/**
 * 证据目录唯一性：每次运行一个独立目录，绝不覆盖历史证据。
 * 目录名带 UTC 时间戳 + runId，即使同一秒跑两次也不会撞（runId 由调用方给随机串）。
 */
export function makeRunDir(baseDir, { runId, now = new Date() } = {}) {
  if (typeof baseDir !== 'string' || !baseDir.trim()) throw new TypeError('baseDir 必须是非空字符串');
  const rid = String(runId ?? '').trim();
  if (!/^[a-z0-9]{6,16}$/i.test(rid)) throw new TypeError('runId 必须是 6–16 位字母数字');
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  return `${baseDir.replace(/[\\/]+$/, '')}/${stamp}-${rid}`;
}

/**
 * 证据完整性自查：一次运行必须同时具备"原始输出 / 规范化计划 / brief / 检查结果"。
 * 缺任何一项都说明证据链断了，不能拿来评分。
 */
export function assessEvidenceCompleteness(themeArtifacts) {
  const missing = [];
  const required = ['rawModelText', 'normalizedPlan', 'sceneBrief', 'sceneReview'];
  for (const key of required) {
    if (themeArtifacts?.[key] == null || themeArtifacts[key] === '') missing.push(key);
  }
  return { complete: missing.length === 0, missing };
}
