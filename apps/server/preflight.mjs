/**
 * Preflight：生成前的"需要用户拍板的选择"。
 * 内测版原则：AI 能自己决定的不打扰用户；但涉及主观审美（字体气质/视觉风格/页面方向）时，
 * 必须先给出候选让用户选，而不是替用户拍板。用户可选"让你决定"以跳过。
 *
 * 设计：一次 LLM 调用（低温、限 token）→ 返回 { questions: [] }，每项含 id/title/options[]。
 * 失败安全：解析失败 → 返回空 questions（不阻断生成，由后续 Brief 自行决定），并标注 viaLLM=false。
 */
import { pickGateway, chat, extractJson } from './llm.mjs';
import { CATALOG } from './generator/styles.mjs';

const SYSTEM = `你是 OrchestrAI 的「开工前确认」助手。用户给了一句建站需求，你需要判断：哪些**主观审美选择**必须由用户拍板，不能替用户猜。

规则：
1. 只问"审美/方向"类选择，最多 3 个问题。不问道理、不问功能细节、不问技术实现。
2. 每个问题给 3-4 个**具体**选项（不是空话）：如字体气质给"现代无衬线 / 典雅衬线 / 等宽终端"，视觉风格给 2-3 个真实风格名。
3. 需求已经说清楚了就不问（宁缺毋滥）。若完全无法判断，返回空数组。
4. 选项要能直接落到生成参数上：
   - style 类问题的 value 必须**逐字使用**候选清单里的风格 ID（不是风格名，不是自造词）
   - font 类问题的 value 只能是 serif / sans / mono
   - direction 类问题的 value 用简短英文标识（如 explore / showcase / story / dashboard）

输出严格 JSON：
{"questions":[{"id":"font","title":"标题字体气质","reason":"为什么需要你选","options":[{"value":"serif","label":"典雅衬线","hint":"适合文化/高端品牌"}]}]}
可选的问题 id 只能是：font（字体气质）、style（视觉风格）、direction（页面方向/叙事结构）、tone（语气/文案调性）。`;

/** 把用户可选的风格压缩成 "ID｜名称" 列表，供模型精确引用（避免自造 ID） */
function styleChoicesForPrompt(limit = 60) {
  return CATALOG.slice(0, limit).map((s) => `${s.id}｜${s.name}`).join('\n');
}

export async function preflight(requirement, llmChoice = 'auto') {
  const gw = pickGateway(llmChoice);
  if (!gw) {
    return { ok: false, viaLLM: false, questions: [], reason: '未配置模型，无法进行开工前确认' };
  }
  try {
    const text = await chat(gw, [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `需求：${String(requirement).slice(0, 2000)}\n\n可选视觉风格清单（格式 ID｜名称，style 问题的 value 必须逐字用左侧 ID）：\n${styleChoicesForPrompt(60)}`,
      },
    ], { temperature: 0.2, maxTokens: 900 });
    const raw = extractJson(text);
    const validStyleIds = new Set(CATALOG.map((s) => s.id));
    const questions = (Array.isArray(raw?.questions) ? raw.questions : [])
      .map((q) => {
        const id = ['font', 'style', 'direction', 'tone'].includes(q?.id) ? q.id : null;
        const options = (Array.isArray(q?.options) ? q.options : [])
          .map((o) => {
            let value = String(o?.value ?? o?.label ?? '').slice(0, 80);
            // 兜底：模型自造了风格 ID（如 pink-neumorph）→ 用名称反查真实 ID
            if (id === 'style' && !validStyleIds.has(value)) {
              const byName = CATALOG.find((s) => s.name === String(o?.label ?? '') || s.id === String(o?.label ?? ''));
              value = byName?.id ?? '';
            }
            if (id === 'font' && !['serif', 'sans', 'mono'].includes(value)) {
              const m = /serif|衬线/i.test(value + (o?.label ?? '')) ? 'serif'
                : /mono|等宽|终端/i.test(value + (o?.label ?? '')) ? 'mono'
                  : 'sans';
              value = m;
            }
            return {
              value,
              label: String(o?.label ?? o?.value ?? '').slice(0, 40),
              hint: String(o?.hint ?? '').slice(0, 60),
            };
          })
          .filter((o) => o.label && o.value)   // 丢弃无法映射到真实参数的选项
          .slice(0, 4);
        return { id, title: String(q?.title ?? '').slice(0, 40), reason: String(q?.reason ?? '').slice(0, 120), options };
      })
      .filter((q) => q.id && q.options.length >= 2)
      .slice(0, 3);
    return { ok: true, viaLLM: true, provider: `${gw.provider}/${gw.model}`, questions };
  } catch (e) {
    const msg = String(e?.message ?? e);
    // 额度/鉴权类失败：不是"跳过就好"，而是生成一定会失败，必须明确告知用户先修模型
    const fatal = /(429|401|403)|quota|额度|上限|invalid.*key|Authentication/i.test(msg);
    return {
      ok: false, viaLLM: true, questions: [],
      fatal,
      reason: fatal
        ? `模型不可用：${msg.slice(0, 140)}。请先在 🔑 主模型面板更换可用的 Key 或等待额度重置。`
        : `确认环节模型调用失败：${msg.slice(0, 120)}（已跳过，直接按需求生成）`,
    };
  }
}

/** 把用户对问题的回答，合并成一句可注入生成流程的「用户已选定」说明 */
export function choicesToDirective(answers) {
  if (!answers || typeof answers !== 'object') return '';
  const LABEL = { font: '字体气质', style: '视觉风格', direction: '页面方向', tone: '文案调性' };
  const parts = [];
  for (const [k, v] of Object.entries(answers)) {
    if (!LABEL[k] || !v) continue;
    if (String(v) === '__ai_decide__') continue; // 用户选择"让你决定"
    parts.push(`${LABEL[k]}：${String(v).slice(0, 60)}`);
  }
  return parts.length ? `【用户已在开工前确定】${parts.join('；')}。请严格遵循这些选择，不要改。` : '';
}

/**
 * 把用户选择翻译成**生成参数硬约束**（而不是只塞进需求文字）。
 * 问题根因：此前 choices 只拼成一句自然语言，最终被 detectStyle 的关键词识别覆盖
 * （"3d果冻质感"命中 clay-obsidian，用户选的 pink-neumorph 被静默丢弃）。
 * @returns {{styleId?:string, font?:'serif'|'sans'|'mono', direction?:string, rationale:string[]}}
 */
export function choicesToParams(answers) {
  const out = { rationale: [] };
  if (!answers || typeof answers !== 'object') return out;
  const style = answers.style;
  if (style && style !== '__ai_decide__' && CATALOG.some((s) => s.id === style)) {
    out.styleId = style;
    out.rationale.push(`视觉风格 = ${style}（用户选择，锁定）`);
  }
  const font = answers.font;
  if (font && ['serif', 'sans', 'mono'].includes(font)) {
    out.font = font;
    out.rationale.push(`字体气质 = ${font}（用户选择，锁定）`);
  }
  if (answers.direction && answers.direction !== '__ai_decide__') {
    out.direction = String(answers.direction).slice(0, 60);
    out.rationale.push(`页面方向 = ${out.direction}（用户选择，锁定）`);
  }
  return out;
}
