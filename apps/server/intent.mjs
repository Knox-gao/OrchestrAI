/**
 * LLM 意图解析：把自然语言需求解析为生成规格（P4）。
 * 失败安全：任何异常由调用方捕获后回退规则识别（parseSentence）。
 */
import { chat, extractJson } from './llm.mjs';

const KNOWN_TYPES = ['todo', 'pomodoro', 'counter', 'notes', 'gallery', 'countdown', 'landing', 'atlas'];

const SYSTEM = `你是 OrchestrAI 的需求解析器。把用户的软件需求解析为严格的 JSON（只输出 JSON，不要任何多余文本）。

字段要求：
type: 从这些类型里选最合适的一个：
  todo=任务清单 pomodoro=番茄钟 counter=计数器/打卡 notes=笔记/速记
  gallery=展馆/图库/相册 countdown=倒数日/纪念日 landing=产品介绍页/专题页/官网/宣传页
  atlas=三维图谱/星图/演变史/博物馆/全系收录（用户想要沉浸式三维可视化时选这个）
  若都不合适，选 landing（通用展示页）。
title: 不超过 16 字的中文项目名（去掉"做一个"等动词，提炼核心）。
subject: 主题关键词（展馆/图库类用于搜图；其他类型填空字符串）。
features: 3-6 条核心功能描述（字符串数组）。
landing: 仅 type=landing 时提供：
  headline: 产品/主题主标题（如 iPhone 17 Pro Max）
  tagline: 一句话卖点
  intro: 2-3 句产品介绍
  features: [{"t":"特性名","d":"特性描述"}] 3-6 条，写真实有说服力的内容
  specs: [["参数名","值"]] 4-6 条（如 电池续航/芯片/摄像头）；产品类需求请依据真实公开资料填写参数

atlas: 仅 type=atlas 时提供：theme(图谱主题名)、unitLabel(时间单位,默认"年份")、objects: [{name,sub,desc(40字内),year(真实年份),metric(数值),metricLabel(指标名),orbit(0-1 轨道半径,中心主体=0,其余按重要性/顺序 0.1-1 递增),size(2-11 视觉大小,中心主体最大),color(#hex 必取该对象真实主导色,如地球蓝火星红木星棕),ring(可选,有明显光环者如土星=true)}] 12-24 个对象，联网查证真实数据按 year 升序；第一个对象作为中心主体(orbit:0,size:11)。

gallery: 仅 type=gallery 时提供，结构为 gallery:{subject:"搜图主题关键词", items:[...]}。若需求是"一组对象的介绍+配图"（如全部超级英雄、全系产品、历代经典、全部成员图鉴），items 必填：[{name(对象官方中文名),sub(10-20字副题,如本名/头衔),desc(50-90字真实介绍,联网查证),query(配图搜索词：优先该对象最通行的称呼——官方译名或英文名（如"绯红女巫"/"Scarlet Witch"），不要生僻译名，不加多余修饰)}] 8-24 个按重要性排序，此时每个对象会定向配一张真实照片；纯图库需求 items 可省略。

design: 你同时担任视觉设计师。若用户未明确指定风格/配色（需求里出现"赛博朋克风/极简风/某种颜色"等算明确指定，此时省略 design），必须根据项目主题智能定制视觉：desc=40-70字设计简报，必含：①主题气质定位（如"漫威电影红金海报感""昭和咖啡店暖棕""北欧极简白净"）②主色 #hex（取主题真实品牌色，如漫威#E62429、星巴克#00704A）③明暗基调（深色/浅色底）④质感词（衬线标题/圆润卡片/锐利直角/等宽数字等）。accent=主色#hex 与 desc 一致。禁止输出通用科技蓝紫——要像设计师为该品牌提案。

重要：输出务必精简且完整收尾——intro 不超过 60 字，每条 feature 的 d 不超过 40 字，总输出必须以最后一个 ] 和 } 完整结束，不得中途停止。

示例输出：
{"type":"gallery","title":"法拉利展馆","subject":"法拉利","features":["照片墙","灯箱浏览","搜索"]}`;

/**
 * LLM 解析需求。返回与 parseSentence 同构的 spec 增量 + viaLLM 标记。
 * @param {string} requirement 用户需求
 * @param {string} projectName 项目名（可能为空）
 * @param {{provider:string,key:string,model:string,defaultBaseUrl:string}} gw 网关
 * @param {Function} fallbackSpec 规则解析结果（用于类型校验与默认值）
 */
export async function parseIntentWithLLM(requirement, projectName, gw, fallbackSpec) {
  const user = `项目名（可能为空）：${projectName || '（未提供）'}
需求：${requirement}`;
  const text = await chat(gw, [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user },
  ], { temperature: 0.2, maxTokens: 8000, webSearch: true });

  const raw = extractJson(text);
  const type = KNOWN_TYPES.includes(raw.type) ? raw.type : fallbackSpec.type;

  const intent = {
    viaLLM: true,
    llmProvider: `${gw.provider}/${gw.model}`,
    type,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 24) : fallbackSpec.title,
    subject: typeof raw.subject === 'string' ? raw.subject.trim().slice(0, 24) : '',
    features: Array.isArray(raw.features) ? raw.features.filter((f) => typeof f === 'string' && f.trim()).slice(0, 6) : fallbackSpec.features,
  };
  if (type === 'atlas') {
    const A = raw.atlas ?? {};
    const objects = (Array.isArray(A.objects) ? A.objects : [])
      .map((o) => ({
        name: String(o?.name ?? '').slice(0, 30),
        sub: String(o?.sub ?? '').slice(0, 40),
        desc: String(o?.desc ?? '').slice(0, 160),
        year: Number.isFinite(Number(o?.year)) ? Number(o.year) : 2020,
        metric: Number.isFinite(Number(o?.metric)) ? Number(o.metric) : undefined,
        metricLabel: String(o?.metricLabel ?? '').slice(0, 12),
        orbit: Number.isFinite(Number(o?.orbit)) ? Math.max(0, Math.min(1, Number(o.orbit))) : undefined,
        size: Number.isFinite(Number(o?.size)) ? Math.max(2, Math.min(11, Number(o.size))) : undefined,
        color: /^#[0-9a-fA-F]{6}$/.test(String(o?.color)) ? String(o.color) : undefined,
        ring: o?.ring === true ? true : undefined,
      }))
      .filter((o) => o.name)
      .slice(0, 36);
    intent.atlas = {
      theme: String(A.theme ?? intent.title).slice(0, 40),
      unitLabel: String(A.unitLabel ?? '年份').slice(0, 8),
      objects: objects.length >= 3 ? objects : [],
    };
  }
  if (type === 'gallery') {
    // items 兼容两层位置：gallery.items（schema 指定）与根级 items（模型常见漂移）
    const G = raw.gallery ?? {};
    const rawItems = Array.isArray(G.items) ? G.items : (Array.isArray(raw.items) ? raw.items : []);
    const items = rawItems
      .map((it) => ({
        name: String(it?.name ?? '').slice(0, 30),
        sub: String(it?.sub ?? '').slice(0, 40),
        desc: String(it?.desc ?? '').slice(0, 200),
        query: String(it?.query ?? it?.name ?? '').slice(0, 60),
      }))
      .filter((it) => it.name && it.desc)
      .slice(0, 24);
    intent.gallery = { items: items.length >= 4 ? items : [] };
    if (!intent.subject && G.subject) intent.subject = String(G.subject).slice(0, 40);
  }
  if (raw.design && typeof raw.design === 'object' && String(raw.design.desc ?? '').trim()) {
    intent.design = {
      desc: String(raw.design.desc).slice(0, 160),
      accent: /^#[0-9a-fA-F]{6}$/.test(String(raw.design.accent ?? '')) ? String(raw.design.accent) : null,
    };
  }
  if (type === 'landing') {
    const L = raw.landing ?? {};
    intent.landing = {
      headline: String(L.headline ?? intent.title).slice(0, 40),
      tagline: String(L.tagline ?? '').slice(0, 80),
      intro: String(L.intro ?? '').slice(0, 400),
      features: (Array.isArray(L.features) ? L.features : [])
        .map((f) => ({ t: String(f?.t ?? '').slice(0, 30), d: String(f?.d ?? '').slice(0, 120) }))
        .filter((f) => f.t)
        .slice(0, 6),
      specs: (Array.isArray(L.specs) ? L.specs : [])
        .map((s) => [String(s?.[0] ?? '').slice(0, 20), String(s?.[1] ?? '').slice(0, 40)])
        .filter((s) => s[0])
        .slice(0, 8),
    };
    if (intent.landing.features.length === 0) {
      intent.landing.features = [{ t: '核心特性', d: '由需求自动整理' }];
    }
  }
  return intent;
}
