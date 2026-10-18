/**
 * Design Brief 正式化（阶段二任务 B）：
 *   - generateBrief()：LLM 产出结构化双方向 Brief（复用阶段一 H2 验证过的提示词），记录调用元数据（耗时/tokens/重试/解析）
 *   - normalizeBrief()：accent 严格提取（宽容抽取首个合法 #hex，非法回退并记录）；字段规范化
 *   - validateBrief()：schema 校验——必填路径/枚举/色值/双方向实质差异（≥3 维）不通过即明确报错，绝不静默
 * 失败安全：任何异常由调用方（pipeline）回退到旧 design.desc 简报路径（pageShell 布局）。
 */
import { chat } from '../llm.mjs';

const LAYOUT_ENUM = ['editorial', 'workbench', 'stage', 'minimal', 'magazine', 'showcase', 'catalog'];
export const FALLBACK_ACCENT = '#64748b';

const SYSTEM = `你是 OrchestrAI 的首席产品设计师。为网站需求输出结构化 Design Brief（只输出 JSON）。
要求：
1. directions 必须包含 2 个实质差异方向——在布局策略、首屏构图、内容密度、图片使用、页面节奏、动效上至少 4 项不同；只换颜色/圆角不算差异。
2. layoutStrategy 只能取：${LAYOUT_ENUM.join(' / ')}。
3. accent 必须是纯色值 "#RRGGBB"，不得附加任何文字说明。
4. 文字具体可执行，禁止空话。

JSON 结构：
{"positioning":{"audience":"","mission":"","conversion":""},"brandKeywords":[],
 "references":[{"site":"","takeaway":""}],
 "directions":[{"name":"","layoutStrategy":"","heroComposition":"","density":"","typography":{"display":"","body":""},"imageUse":"","color":{"bg":"","accent":"#RRGGBB","mood":""},"motion":"","rhythm":""},{"第二个方向"}],
 "tokens":{"maxWidth":"","grid":"","spacingScale":"","radius":"","breakpoints":""},
 "imageDirection":{"style":"","mood":"","composition":"","palette":"","avoid":""},
 "a11y":{"contrast":"","minBodyPx":""}}
重要：输出精简且完整收尾，必须以最后一个 } 结束。`;

/** 严格提取合法主色：容忍"附注污染"（"#1A1A1A 近黑+细线"→#1A1A1A）；无合法值 → null */
export function extractAccent(raw) {
  const m = String(raw ?? '').match(/#([0-9a-fA-F]{6})\b/);
  return m ? '#' + m[1].toLowerCase() : null;
}

const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);

/** 规范化：accent 严格化（非法→记录并回退）；directions 结构补全 */
export function normalizeBrief(raw) {
  const notes = [];
  const brief = JSON.parse(JSON.stringify(raw));
  for (const d of brief.directions ?? []) {
    const acc = extractAccent(d?.color?.accent);
    if (!acc) {
      notes.push(`方向「${d?.name ?? '?'}」accent 非法（${String(d?.color?.accent).slice(0, 30)}）→ 回退 ${FALLBACK_ACCENT}`);
      d.color = { ...d?.color, accent: FALLBACK_ACCENT, accentFallback: true };
    } else if (acc !== String(d.color.accent).trim().toLowerCase()) {
      notes.push(`方向「${d?.name ?? '?'}」accent 含附注 → 提取 ${acc}`);
      d.color = { ...d.color, accent: acc };
    }
  }
  return { brief, notes };
}

const DIFF_DIMS = ['layoutStrategy', 'heroComposition', 'density', 'imageUse', 'motion', 'rhythm'];

/** schema 校验：返回 {ok, errors[]}——缺字段/非法枚举/非法色值/双方向差异不足都会列出，不静默 */
export function validateBrief(b) {
  const errors = [];
  const req = [
    'positioning.audience', 'positioning.mission', 'positioning.conversion', 'brandKeywords',
    'references.0.site', 'references.0.takeaway',
    'tokens.maxWidth', 'tokens.grid', 'tokens.spacingScale', 'tokens.radius', 'tokens.breakpoints',
    'imageDirection.style', 'imageDirection.mood', 'imageDirection.composition', 'imageDirection.palette', 'imageDirection.avoid',
    'a11y.contrast', 'a11y.minBodyPx',
  ];
  for (const p of req) {
    const v = get(b, p);
    if (v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0)) {
      errors.push(`缺失必填字段：${p}`);
    }
  }
  if (!Array.isArray(b?.directions) || b.directions.length < 2) {
    errors.push('directions 必须包含 2 个方向');
  } else {
    b.directions.forEach((d, i) => {
      for (const p of ['name', 'layoutStrategy', 'heroComposition', 'density', 'typography.display', 'imageUse', 'color.bg', 'color.accent', 'motion', 'rhythm']) {
        const v = get(d, p);
        if (v === undefined || v === null || String(v).trim() === '') errors.push(`directions[${i}] 缺失：${p}`);
      }
      if (!LAYOUT_ENUM.includes(d.layoutStrategy)) errors.push(`directions[${i}].layoutStrategy 非法枚举：${d.layoutStrategy}`);
      if (!/^#[0-9a-fA-F]{6}$/.test(String(d?.color?.accent ?? ''))) errors.push(`directions[${i}].accent 非法色值：${d?.color?.accent}`);
    });
    const [a, c] = b.directions;
    const diff = DIFF_DIMS.filter((k) => String(a?.[k] ?? '') !== String(c?.[k] ?? ''));
    if (diff.length < 3) errors.push(`双方向实质差异不足（仅 ${diff.length}/6 维不同：${diff.join(',')}）——换色不算差异`);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 生成 Brief（真实 LLM 调用 + 元数据记录）。
 * @returns {Promise<{brief:Object, notes:string[], callMeta:{ms,retries,parseOk,tokens,provider,model}}>}
 * @throws 解析/校验失败抛出（含 callMeta 附加于 err.meta），由调用方回退。
 */
export async function generateBrief(requirement, projectName, gw) {
  const callMeta = { provider: gw?.provider ?? '', model: gw?.model ?? '', ms: 0, retries: 0, parseOk: false, tokens: null };
  let raw = null, lastErr = null;
  for (let attempt = 1; attempt <= 2 && !raw; attempt++) {
    const t0 = performance.now();
    try {
      const text = await chat(gw, [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `项目名：${projectName || '（未提供）'}\n需求：${requirement}` },
      ], { temperature: 0.4, maxTokens: 4000 });
      callMeta.ms += Math.round(performance.now() - t0);
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      raw = JSON.parse(text.slice(start, end + 1));
      callMeta.parseOk = true;
    } catch (e) {
      callMeta.ms += Math.round(performance.now() - t0);
      callMeta.retries++;
      lastErr = e;
    }
  }
  if (!raw) {
    const err = new Error(`Brief 解析失败（重试${callMeta.retries}次）：${String(lastErr?.message ?? lastErr).slice(0, 90)}`);
    err.meta = callMeta;
    throw err;
  }
  const { brief, notes } = normalizeBrief(raw);
  const v = validateBrief(brief);
  if (!v.ok) {
    const err = new Error(`Brief schema 校验未过（${v.errors.length} 项）：${v.errors.slice(0, 3).join('；')}`);
    err.meta = { ...callMeta, validationErrors: v.errors };
    throw err;
  }
  return { brief, notes, callMeta: { ...callMeta, tokens: brief?.usage?.total_tokens ?? null } };
}
