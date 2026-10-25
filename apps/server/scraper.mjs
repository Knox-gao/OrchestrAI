/**
 * 网络图片采集器（零依赖）：
 *   适配器链 Pexels(用户key) → Unsplash(用户key) → Bing 图片(免key,直连) →
 *            Reddit Images(免key,经代理) → DuckDuckGo Images(免key,经代理) → Wikimedia Commons(免key,经代理)
 *            Wikipedia 权威肖像(免key,经代理,需 wikiTitle) 可按需插到链首
 *   任一不可达/无结果自动跳到下一个；全部失败 → 返回空（由流水线用本地程序化示意卡兜底）
 *   成品调研结论（2026-10）：portia/pyspider 均已官方归档且为定向网站抓取框架，不适用本场景，未采用；
 *   DDG 适配器借鉴 duckduckgo-images-api 的 vqd+i.js 手法；被墙源经 proxy.mjs（系统代理探测+CONNECT 隧道）出网。
 * 版权合规：只下载原图缩略版，保留 作者 / 许可证 / 来源页 并随应用展示署名。
 */
import { detectProxy, proxyFetch } from './proxy.mjs';

/** 外部源抓取：探测到系统代理则走 CONNECT 隧道（被墙源），否则直连（海外环境） */
async function externalFetch(url, { headers = {}, timeout = 12_000 } = {}) {
  const proxy = await detectProxy();
  if (proxy) {
    try { return await proxyFetch(url, { headers, timeout }); } catch { /* 代理失败回退直连 */ }
  }
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
  return { status: r.status, ok: r.ok, buf: Buffer.from(await r.arrayBuffer()) };
}

const UA = 'AgentStudio/1.0 (local app generator; +https://localhost)';
const PER_IMAGE_TIMEOUT = 12_000;
const PER_IMAGE_MAX_BYTES = 3 * 1024 * 1024;

async function fetchJson(url, headers = {}, timeout = 15_000) {
  await bingThrottle();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

/* ---------- 候选适配器：返回 [{url,title,author,license,page}] ---------- */

async function pexelsSearch(query, count, key) {
  const data = await fetchJson(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${Math.min(count + 4, 20)}&orientation=landscape`,
    { Authorization: key },
  );
  return (data.photos ?? []).slice(0, count + 2).map((p) => ({
    url: p.src?.large2x ?? p.src?.large,
    title: p.alt || `Photo by ${p.photographer}`,
    author: p.photographer,
    license: 'Pexels License',
    page: p.url,
  }));
}

async function unsplashSearch(query, count, key) {
  const data = await fetchJson(
    `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${Math.min(count + 4, 20)}&content_filter=high&client_id=${encodeURIComponent(key)}`,
  );
  return (data.results ?? []).slice(0, count + 2).map((p) => ({
    url: p.urls?.regular,
    title: p.alt_description || p.description || `Photo by ${p.user?.name}`,
    author: p.user?.name,
    license: 'Unsplash License',
    page: p.links?.html,
  }));
}

async function wikimediaSearch(query, count) {
  const api = `https://commons.wikimedia.org/w/api.php?action=query&generator=search`
    + `&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=${Math.min(count + 6, 24)}`
    + `&prop=imageinfo&iiprop=url|mime|size|extmetadata&iiurlwidth=1024&format=json`;
  const r = await externalFetch(api, { headers: { 'User-Agent': UA }, timeout: 12_000 });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = JSON.parse(r.buf.toString('utf8'));
  const pages = Object.values(data?.query?.pages ?? {});
  return pages
    .filter((p) => {
      const ii = p.imageinfo?.[0];
      return ii && ['image/jpeg', 'image/png', 'image/webp'].includes(ii.mime) && (ii.width ?? 0) >= 640;
    })
    .slice(0, count + 2)
    .map((p) => {
      const ii = p.imageinfo[0];
      const meta = ii.extmetadata ?? {};
      return {
        url: ii.thumburl ?? ii.url,
        title: String(p.title).replace(/^File:/, '').replace(/\.(jpe?g|png|webp)$/i, ''),
        author: meta.Artist?.value?.replace(/<[^>]+>/g, '').trim() || 'Wikimedia contributor',
        license: (meta.LicenseShortName?.value ?? 'See source').replace(/<[^>]+>/g, ''),
        page: ii.descriptionurl ?? 'https://commons.wikimedia.org',
      };
    });
}

/**
 * DuckDuckGo 图片搜索（借鉴 GitHub 成品 duckduckgo-images-api 的手法）：
 *   首页提取 vqd token → i.js 接口拿 JSON 结果（原图 image + 缩略 thumbnail + 来源页）。
 *   免 key；网络不可达（如 duckduckgo.com 被墙）时适配器链自动跳过。
 *   参考实现：https://github.com/roflmywaffle/duckduckgo-images-api（MIT）
 */
async function ddgSearch(query, count) {
  const home = await externalFetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }, timeout: 12_000,
  });
  const html = home.buf.toString('utf8');
  if (!home.ok) throw new Error(`HTTP ${home.status}`);
  const vqd = html.match(/vqd=["']?([\d-]{4,})/)?.[1];
  if (!vqd) throw new Error('vqd token 提取失败');
  const data = JSON.parse((await externalFetch(
    `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,&p=1`,
    { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://duckduckgo.com/', 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, timeout: 12_000 },
  )).buf.toString('utf8'));
  if (data?.challenge) throw new Error('DDG 反爬挑战（challenge）');
  return (data.results ?? [])
    .filter((r) => r.image)
    .slice(0, count + 2)
    .map((r) => ({
      url: r.image,
      fallbackUrl: r.thumbnail && r.thumbnail !== r.image ? r.thumbnail : null,
      title: String(r.title ?? '').slice(0, 80) || `${query} · 图片`,
      author: r.source ? `来源站 ${r.source}` : 'DuckDuckGo Images',
      license: 'via DuckDuckGo Images',
      page: r.url ?? '',
    }));
}

/**
 * Reddit 图片搜索（官方 search.json，免 key，经代理）：
 * 高赞图片帖按相关性排序——冷门角色（银河护卫队/漫画人物）社区图质量远超图库站。
 * 取 url_overridden_by_dest / preview 大图，剔除相册与视频帖。
 */
async function redditSearch(query, count) {
  const u = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=30&sort=relevance&t=all`;
  const r = await externalFetch(u, { headers: { 'User-Agent': 'OrchestrAI/1.0 (app image collector)' }, timeout: 12_000 });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = JSON.parse(r.buf.toString('utf8'));
  const out = [];
  for (const child of data?.data?.children ?? []) {
    const p = child?.data;
    if (!p || p.is_gallery || p.is_video || p.over_18) continue;
    const img = p.url_overridden_by_dest
      || p.preview?.images?.[0]?.source?.url?.replace(/&amp;/g, '&')
      || p.url;
    if (!/^https?:\/\/.+\.(jpe?g|png|webp)(\?|$)/i.test(img ?? '')) continue;
    out.push({
      url: img,
      fallbackUrl: p.preview?.images?.[0]?.resolutions?.slice(-1)[0]?.url?.replace(/&amp;/g, '&') ?? null,
      title: String(p.title ?? '').slice(0, 80),
      author: `r/${p.subreddit} · u/${p.author ?? '?'}`,
      license: 'via Reddit',
      page: `https://www.reddit.com${p.permalink ?? ''}`,
    });
    if (out.length >= count + 2) break;
  }
  return out;
}

/**
 * 英文维基百科权威肖像（文章头图，pilicense=any 含非自由版权剧照/封面）：
 * 图鉴对象的终极兜底——文章头图天然与对象对位，杜绝配图错位。经代理出网。
 */
async function wikipediaPortraitCandidates(enTitle, count) {
  const u = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(enTitle)}`
    + `&prop=pageimages&piprop=original|thumbnail&pithumbsize=900&pilicense=any&format=json&redirects=1`;
  const r = await externalFetch(u, { headers: { 'User-Agent': 'OrchestrAI/1.0 (app generator)' }, timeout: 12_000 });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = JSON.parse(r.buf.toString('utf8'));
  const page = Object.values(data?.query?.pages ?? {})[0];
  const src = page?.original?.source ?? page?.thumbnail?.source;
  if (!src || page?.missing) return [];
  const pageTitle = String(page.title ?? enTitle);
  return [{
    url: src,
    fallbackUrl: page?.thumbnail?.source && page.thumbnail.source !== src ? page.thumbnail.source : null,
    title: pageTitle,
    author: 'Wikipedia',
    license: 'via Wikipedia',
    page: `https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replace(/ /g, '_'))}`,
  }].slice(0, count + 2);
}

/**
 * Bing 图片搜索（GitHub bing-image-downloader 类项目的标准做法）：
 * 请求 images/async 接口 → 从 iusc 锚点的 m="{...}" 属性解析原图(murl)/缩略图(turl)/来源页(purl)。
 * 质量控制：qft 仅照片+大图过滤；候选需与查询词相关（标题或来源页命中）。
 * 原图优先，失败回退缩略图；署名为来源站点域名。
 */
/**
 * 构造 Bing 图片相关性判定（导出以便回归测试）。
 *
 * 为什么不用"最长的词"做锚点：实测 `ferrari showroom architecture` 的 35 条候选里
 * 有 26 条真带 ferrari，但最长词 architecture 命中 0 条 → 26 张真法拉利照被整批
 * 丢弃 → 退化成矢量插画。这是"图片总被替换成矢量插画"的主因之一。
 *
 * 两段式：严格（主体词 + 一个实词）优先；严格全空时，若主体词是品牌/车型编号
 * 这类专有名词，才退回"只要求主体词"。普通名词（aurora / car / studio）太泛，
 * 会和同名品牌撞车，不享受放宽。
 *
 * @param {string} query 搜索词
 * @returns {{anchor: string|null, anchorIsProperNoun: boolean, enTokens: string[],
 *   cjkTokens: string[], contentTokens: string[], secondaries: string[],
 *   hitStrict: (title: string, page: string) => boolean,
 *   hitRelaxed: (title: string, page: string) => boolean}}
 */
export function buildBingRelevance(query) {
  const spaceTokens = String(query).split(/[\s,，、]+/).map((s) => s.trim()).filter((s) => s.length >= 2);
  const enTokens = spaceTokens.filter((t) => /[a-z-]/i.test(t)).map((t) => t.toLowerCase());
  const cjkTokens = spaceTokens.filter((t) => /^[\u4e00-\u9fff]+$/.test(t));
  const wordHit = (hay, tk) => {
    const escaped = tk.replace(/[.*+?^${}()|[\]\\]/g, (m) => `\\${m}`);
    const re = tk.includes('-') ? new RegExp(escaped, 'i') : new RegExp('\\b' + escaped + '\\b', 'i');
    return re.test(hay);
  };

  // 与画面对象无关的修饰语：不能当主体词，也不能单独满足"第二个词"
  const MODIFIER_TOKENS = new Set([
    'architecture', 'interior', 'exterior', 'design', 'designs', 'poster', 'posters',
    'gradient', 'glowing', 'glow', 'dark', 'light', 'bright', 'moody', 'minimal',
    'minimalist', 'modern', 'luxury', 'luxurious', 'elegant', 'premium', 'abstract',
    'close', 'closeup', 'wide', 'angle', 'view', 'shot', 'photo', 'photography',
    'image', 'picture', 'scene', 'background', 'wallpaper', 'style', 'styled',
    'aesthetic', 'cinematic', 'dramatic', 'atmosphere', 'ambient', 'theme', 'themed',
    'night', 'day', 'evening', 'morning', 'sunset', 'sunrise', 'detail', 'details',
    'texture', 'toned', 'colored', 'blurred', 'sharp', 'high', 'low', 'full', 'with',
    'from', 'that', 'this', 'and', 'the', 'for', 'on', 'at', 'of', 'in', 'by',
    'workspace', 'workspaces', 'sketches', 'sketch', 'dual', 'monitors', 'monitor',
    'neon', 'vibrant', 'cozy', 'clean', 'simple', 'bold', 'soft', 'warm', 'cool',
  ]);

  // 厂牌/系列词：只做限定，不当主体 —— 否则 "Iron Man Marvel" 的锚点会变成 marvel，
  // 任何带 Marvel 字样的图（蜘蛛侠涂鸦墙、cosplay 合影）都会通过。
  const FRANCHISE_TOKENS = new Set(['marvel', 'dc', 'disney', 'pixar', 'avengers', 'x-men', 'xmen', 'mcu', 'studios', 'comics', 'comic', 'universe', 'guardians', 'galaxy', 'star', 'wars']);

  const BRAND_TOKENS = new Set([
    'ferrari', 'lamborghini', 'porsche', 'toyota', 'nissan', 'honda', 'mazda', 'subaru',
    'mitsubishi', 'bmw', 'mercedes', 'audi', 'volkswagen', 'volvo', 'ford', 'chevrolet',
    'tesla', 'bugatti', 'mclaren', 'aston', 'jaguar', 'land', 'rover', 'lexus', 'infiniti',
    'rolls', 'bentley', 'maserati', 'alfa', 'peugeot', 'renault', 'hyundai', 'kia',
    'marvel', 'disney', 'lego', 'apple', 'sony', 'samsung', 'ikea', 'nike', 'adidas',
  ]);
  const isModelCode = (tk) => /(?:[a-z]+\d+[a-z0-9-]*|\d+[a-z][a-z0-9-]*)/.test(tk);

  const contentTokens = enTokens.filter((tk) => !MODIFIER_TOKENS.has(tk));
  // 主体候选：先排除厂牌词，再按 品牌/车型 > 长度 排序
  const subjectTokens = contentTokens.filter((tk) => !FRANCHISE_TOKENS.has(tk));
  const anchor =
    subjectTokens.find((tk) => BRAND_TOKENS.has(tk) || isModelCode(tk))
    ?? subjectTokens.find((tk) => tk.length >= 4)
    ?? subjectTokens[0]
    ?? contentTokens[0]
    ?? [...enTokens].sort((a, b) => b.length - a.length)[0]
    ?? null;

  // 人物/角色名的多个词必须全部命中（"iron man" 两词都要在），
  // 否则只中 "iron" 就会放行铁矿图。只对长度 ≥3 的实词生效，避免被介词干扰。
  const subjectWords = subjectTokens.filter((tk) => tk.length >= 3);
  // 品牌词本身就是足够强的主体证明（ferrari 命中即可，不必再要 showroom）；
  // 只有「非品牌的多词人名」（如 iron + man）才要求全部命中，
  // 否则只中 iron 会放行铁矿图。
  const anchorIsBrand = BRAND_TOKENS.has(anchor) || isModelCode(anchor);
  const requireAllSubjectWords = (hay) => anchorIsBrand
    || subjectWords.length <= 1
    || subjectWords.every((tk) => wordHit(hay, tk));

  const secondaries = contentTokens.filter((tk) => tk !== anchor);
  const needsSecondary = enTokens.length >= 3 && secondaries.length > 0;

  /** 严格判定：主体词 + 一个额外实词。 */
  const hitStrict = (title, page) => {
    const hay = `${title} ${page}`.toLowerCase();
    if (cjkTokens.some((tk) => hay.includes(tk))) return true;
    if (enTokens.length === 0 || !anchor) return false;
    if (!wordHit(hay, anchor)) return false;
    if (!requireAllSubjectWords(hay)) return false;
    if (needsSecondary) return secondaries.some((tk) => wordHit(hay, tk));
    return true;
  };

  /**
   * 放宽判定：只要主体词命中。
   *
   * 仅在严格判定一张都没选中时回退。理由："ferrari showroom architecture" 这类
   * 查询里主体词（品牌）命中已足以保证图与页面主题相关 —— 标题没写 showroom
   * 不代表这张法拉利照片不能用在法拉利展馆页。实测 26/35 条真带 brand 却因
   * 缺修饰词被整批判死，最后退化成矢量插画，那是更糟的结果。
   */
  // 只有专有名词（品牌/车型编号）才够格单独作为主体证明；
  // 普通名词（aurora / car / studio）太泛，会撞上同名品牌或无关内容。
  // 专有名词判定：品牌/车型编号，或查询里出现大写开头的词（人名/角色名的典型形态）。
  // 后者很关键 —— 剔除厂牌词后，"Iron Man Marvel" 的锚点是 "iron"，
  // 不在 BRAND_TOKENS 里，若不认大写就会让放宽段彻底失效。
  const hasCapitalizedName = /(?:^|[^A-Za-z])[A-Z][a-z]/.test(String(query ?? ''));
  const anchorIsProperNoun = Boolean(anchor) && (BRAND_TOKENS.has(anchor) || isModelCode(anchor) || hasCapitalizedName);

  const hitRelaxed = (title, page) => {
    const hay = `${title} ${page}`.toLowerCase();
    if (cjkTokens.some((tk) => hay.includes(tk))) return true;
    if (!anchorIsProperNoun) return false;
    if (enTokens.length === 0) return false;
    // 放宽段也只放开"额外实词"，不放开主体词 —— 主体必须齐
    return wordHit(hay, anchor) && requireAllSubjectWords(hay);
  };
  return { anchor, anchorIsProperNoun, enTokens, cjkTokens, contentTokens, secondaries, needsSecondary, hitStrict, hitRelaxed };
}

/**
 * Bing 的最小请求间隔。
 *
 * 实测：短时间内连发 images/async 请求时，Bing 会返回 HTTP 200 但只有 1 条
 * 无关结果（不是报错）—— 很容易被误判成"搜索功能坏了"。
 * 图位上限从 8 提到 24 后并发压力更大，所以这里串行化并保证间隔。
 */
const BING_MIN_INTERVAL_MS = 900;
let bingNextSlot = 0;
async function bingThrottle() {
  const now = Date.now();
  const wait = Math.max(0, bingNextSlot - now);
  bingNextSlot = Math.max(now, bingNextSlot) + BING_MIN_INTERVAL_MS;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function bingSearch(query, count) {
  const url = `https://www.bing.com/images/async?q=${encodeURIComponent(query)}&first=1&count=35`
    + `&qft=${encodeURIComponent('+filterui:photo-photo+filterui:imagesize-large')}&adlt=moderate`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  let html = '';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } finally { clearTimeout(t); }

  // 相关性过滤（v4）：用「主体词」而不是「最长词」做锚点。
  //
  // v3 的教训：最长词常常是修饰语（architecture / glowing / sketches），
  // 真实照片的标题里根本不会出现，于是整批相关图被误杀。实测
  // "ferrari showroom architecture" 的 35 条候选里有 26 条真带 ferrari，
  // 却因为最长词 architecture 命中 0 条而全部丢弃，最终退化成矢量插画。
  //
  // v4 规则：
  //   1) 中文查询：任一完整中文词命中即可（原逻辑不变）。
  //   2) 英文查询：主体词必须命中。主体词按优先级取：
  //        品牌/车型词 > 第一个 ≥4 字母的实词 > 最长实词 > 最长词。
  //   3) 多词查询仍要求额外命中一个**非修饰**词，修饰语单列成表不计入。
  // 宁缺毋滥：不足 count 时不再用无关候选补量（垃圾图比少图伤害更大）。
  const { anchor, anchorIsProperNoun, enTokens, cjkTokens, contentTokens, secondaries, needsSecondary, hitStrict, hitRelaxed } = buildBingRelevance(query);
  const all = [];
  const re = /class="iusc"[^>]*m="(\{[^"]+\})"/g;
  // 扫描候选数与下载数解耦：垃圾常霸占前排，至少评估 24 条候选再按相关性筛选
  const scanLimit = Math.max(24, count * 3);
  let m;
  while ((m = re.exec(html)) && all.length < scanLimit) {
    try {
      const d = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
      if (!d.murl && !d.turl) continue;
      const title = (d.t || '').slice(0, 80);
      const page = d.purl || '';
      let host = '';
      try { host = new URL(page || d.murl || d.turl).hostname; } catch {}
      let decodedPage = page;
      try { decodedPage = decodeURIComponent(page); } catch { /* malformed escapes should not discard the candidate */ }
      all.push({
        url: d.murl || d.turl,
        fallbackUrl: d.turl && d.turl !== (d.murl || '') ? d.turl : null,
        title: title || `${query} · 图片`,
        author: host ? `来源站 ${host}` : 'Bing 图片搜索',
        license: 'via Bing 图片搜索',
        page,
        relevant: hitStrict(title, decodedPage),
        relevantRelaxed: hitRelaxed(title, decodedPage),
      });
    } catch { /* 忽略解析失败的候选 */ }
  }
  const strict = all.filter((x) => x.relevant);
  // 严格段全空时才退回放宽段，避免为凑数降低整体精度
  const filtered = strict.length ? strict : all.filter((x) => x.relevantRelaxed);
  const items = filtered.slice(0, count + 2);
  return items.map(({ relevant, relevantRelaxed, ...rest }) => rest);
}

/* ---------- 下载 ---------- */

/** 被墙的图片 CDN（下载也需经代理） */
const PROXIED_HOSTS = /(^|\.)((wikimedia\.org)|(wikipedia\.org)|(duckduckgo\.com)|(reddit\.com)|(redd\.it)|(redditstatic\.com))$/i;

async function downloadImage(url) {
  // 被墙 CDN：经代理下载（直连会挂起直到超时）；其余直连
  if (PROXIED_HOSTS.test(new URL(url).hostname)) {
    const r = await proxyFetch(url, { headers: { 'User-Agent': UA }, timeout: PER_IMAGE_TIMEOUT });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const head = r.buf.subarray(0, 12).toString('latin1');
    const ext = head.startsWith('\x89PNG') ? 'png' : head.startsWith('RIFF') ? 'webp' : 'jpg';
    if (r.buf.length === 0 || r.buf.length > PER_IMAGE_MAX_BYTES) throw new Error('bad size');
    if (!head.startsWith('\x89PNG') && !head.startsWith('RIFF') && !head.startsWith('\xff\xd8')) throw new Error('not image');
    return { buf: r.buf, ext };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PER_IMAGE_TIMEOUT);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) throw new Error(`not image: ${type}`);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > PER_IMAGE_MAX_BYTES) throw new Error('too large');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > PER_IMAGE_MAX_BYTES) throw new Error('bad size');
    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
    return { buf, ext };
  } finally { clearTimeout(t); }
}

/**
 * 采集入口。
 * 适配器链：Pexels(Key) → Unsplash(Key) → Bing 图片(免Key,直连) → Reddit(免Key,经代理) → DuckDuckGo(免Key,经代理) → Wikimedia Commons(免Key,经代理)
 * 提供 wikiTitle（英文实体名）时，"Wikipedia 权威肖像"（经代理）插到链首——文章头图天然与对象对位。
 * @returns {{images: {buf:Buffer, ext:string, title:string, author:string, license:string, page:string, src?:string}[],
 *            provider: string, errors: string[], tried: string[]}}
 */
export async function collectImages({ query, count = 10, keys = {}, wikiTitle, skipProviders = [] }) {
  const result = { images: [], provider: 'none', errors: [], tried: [] };
  const adapters = [];
  if (wikiTitle) adapters.push({ name: 'Wikipedia 权威肖像', run: () => wikipediaPortraitCandidates(wikiTitle, count) });
  if (keys.pexels) adapters.push({ name: 'Pexels', run: () => pexelsSearch(query, count, keys.pexels) });
  if (keys.unsplash) adapters.push({ name: 'Unsplash', run: () => unsplashSearch(query, count, keys.unsplash) });
  adapters.push({ name: 'Bing 图片搜索', run: () => bingSearch(query, count) });
  adapters.push({ name: 'Reddit Images', run: () => redditSearch(query, count) });
  adapters.push({ name: 'DuckDuckGo Images', run: () => ddgSearch(query, count) });
  adapters.push({ name: 'Wikimedia Commons', run: () => wikimediaSearch(query, count) });
  const skipped = new Set(Array.isArray(skipProviders) ? skipProviders : []);
  const availableAdapters = adapters.filter((adapter) => !skipped.has(adapter.name));

  for (const ad of availableAdapters) {
    result.tried.push(ad.name);
    let candidates = [];
    try {
      candidates = await ad.run();
    } catch (e) {
      result.errors.push(`${ad.name}: 搜索失败（${String(e.message ?? e).slice(0, 80)}）`);
      continue;
    }
    if (candidates.length === 0) {
      result.errors.push(`${ad.name}: 无结果`);
      continue;
    }
    const images = [];
    // 下载候选上限：小批量（逐对象定向采集 count≤2）只多备 1 张；大批量多备 4 张抗过滤
    const cap = count + (count <= 2 ? 1 : 4);
    for (const c of candidates) {
      if (images.length >= cap) break;
      if (!c.url) continue;
      // 原图优先，失败回退候选自带的备选地址（如 Bing 缩略图）
      const urls = [c.url, ...(c.fallbackUrl ? [c.fallbackUrl] : [])];
      let got = null;
      let imageSrc = '';
      let lastErr = '';
      for (const u of urls) {
        try { got = await downloadImage(u); imageSrc = u; break; } catch (e) { lastErr = String(e.message ?? e).slice(0, 50); }
      }
      if (!got) { result.errors.push(`${ad.name}: 下载跳过（${lastErr}）`); continue; }
      // 质量门槛：过小的图（logo/低清缩略图）直接弃用
      if (got.buf.length < 50_000 && images.length >= 3) {
        result.errors.push(`${ad.name}: 过滤低清图（${Math.round(got.buf.length / 1024)}KB）`);
        continue;
      }
      images.push({ buf: got.buf, ext: got.ext, title: c.title, author: c.author, license: c.license, page: c.page, src: imageSrc, size: got.buf.length, provider: ad.name });
    }
    if (images.length > 0) {
      // 大图优先：门面位置放最高清的素材
      result.images = images.sort((a, b) => b.size - a.size).slice(0, count).map(({ size, ...rest }) => rest);
      result.provider = ad.name;
      return result;
    }
  }
  return result;
}

/* ---------- 图鉴定向采集：查询级联与择优 ---------- */

const EN_NOISE = new Set(['movie', 'film', 'photo', 'image', 'wallpaper', 'poster', 'marvel', 'dc', 'cosplay', 'art']);

/**
 * 从 LLM 搜索词中提取英文名（如 "钢铁侠 Iron Man Marvel 电影剧照" → "Iron Man"）。
 * 噪声词（movie/海报类）与厂牌词剔除；至少 4 个字母才算有效。
 */
export function extractEnglishTokens(str) {
  const words = String(str ?? '').match(/[A-Za-z][A-Za-z-]{1,}/g) ?? [];
  const kept = words.filter((w) => !EN_NOISE.has(w.toLowerCase())).slice(0, 3);
  const joined = kept.join(' ');
  return joined.replace(/[^A-Za-z -]/g, '').length >= 4 ? joined : '';
}

/**
 * 多候选择优：按标题与目标词（对象名/英文名）的重叠度打分，取最贴合者。
 * 计分：完整词命中 = 词长×10（强命中）；最长片段命中 = 片段长（弱命中，仅作同强度内排序）。
 * strict 模式：至少一次完整词命中才返回结果，否则返回 null（配图无把握宁可不猜——交由维基肖像兜底）。
 */
export function bestMatch(images, targets, { strict = false } = {}) {
  const list = images ?? [];
  if (list.length === 0) return null;
  const tgts = (targets ?? []).filter(Boolean).map((t) => String(t).toLowerCase());
  let best = null, bestScore = 0, bestStrong = false;
  for (const img of list) {
    const hay = String(img.title ?? '').toLowerCase() + ' ' + String(img.page ?? '').toLowerCase();
    let score = 0, strong = false;
    for (const t of tgts) {
      if (!t) continue;
      if (hay.includes(t)) { score += t.length * 10; strong = true; continue; }
      // 最长片段命中（弱，仅排序用）
      for (let len = Math.min(t.length, 6); len >= 2; len--) {
        let frag = false;
        for (let i = 0; i + len <= t.length; i++) {
          if (hay.includes(t.slice(i, i + len))) { frag = true; break; }
        }
        if (frag) { score += len; break; }
      }
    }
    if (score > bestScore) { best = img; bestScore = score; bestStrong = strong; }
  }
  if (!best) return null;
  if (strict && !bestStrong) return null;
  return best;
}

/**
 * 查询级联：为一个图鉴对象生成从最准到最宽的搜索词序列。
 * ① 对象全名（中文实体词，Bing 中文最准）② LLM 搜索词 ③ 英文名（中国市场的 Bing 对英文实体同样有效）
 * ④ 长名前缀截断（"钢铁蜘蛛侠战衣"→"钢铁蜘蛛侠"）⑤ 副题里的本名（"彼得·奎尔"）
 */
export function queryCascade(it) {
  const name = String(it?.name ?? '').trim();
  const out = [];
  if (name) out.push(name);
  const q = String(it?.query ?? '').trim();
  if (q && q !== name) out.push(q);
  const en = extractEnglishTokens(q || name);
  if (en) out.push(en);
  if (name.length >= 5) out.push(name.slice(0, 4));
  const sub = String(it?.sub ?? '').split(/[,，、/，(（]/)[0]?.replace(/[\s·]/g, '') ?? '';
  if (sub.length >= 2 && sub !== name && !name.includes(sub)) out.push(sub);
  return [...new Set(out.filter(Boolean))];
}
