/**
 * Wikipedia 角色肖像（准确率优先）。
 *
 * 为什么不用 pageimages（条目头图）：
 *   实测漫威角色条目大多没有头图 —— Gamora / Spider-Man / Black Panther
 *   走 pageimages 全部返回 no image，于是回退到搜索引擎，抓回来的
 *   是漫展 cosplay、演员生活照、涂鸦墙。
 *
 * 改用**正文插图**（prop=images）后，能拿到真正属于该角色的官方形象：
 *   Iron Man      → Iron Man (circa 2018).png / Tales of Suspense 39.jpg
 *   Gamora        → Gamora-cover.jpg / GamoraAnimated2016.jpg
 *   Black Panther → Black Panther (T'Challa).png（消歧义跳转后）
 *   Doctor Strange→ DoctorStrange-177.jpg
 *
 * 准确率来自两个硬信号：
 *   1. 图出自该角色**自己的**维基条目正文（不是全站搜索）
 *   2. 文件名必须包含角色名（"Black Panther (T'Challa).png" 命中，
 *      "Chadwick Boseman by Gage Skidmore.jpg" 不命中 → 演员照被剔除）
 */

import { detectProxy, proxyFetch } from './proxy.mjs';

const UA = { 'User-Agent': 'OrchestrAI/1.0 (app generator)' };
const API = 'https://en.wikipedia.org/w/api.php';

/** 非内容图：图标、旗帜、状态标记、维护模板 */
const NON_CONTENT_FILE = /(?:icon|logo|symbol|question_book|commons-logo|wiki|edit|ambox|disambig|padlock|sound|folder|portal|star|crystal|nuvola|flag of|featured|shackle|cscr|dragon-|commons|wikisource|wikiquote|open access|red pencil|semi-protection|padlock)/i;

/** 演员/作者照片的典型形态：「X as Y」「(cropped)」「by <photographer>」 */
// 只排「明确的真人照片」形态。不能把 comic-con 整体排掉 ——
// 那条规则会误伤同条目里的角色图（实测 Captain America 条目被连坐）。
const ACTOR_FILE = /(?:\bas\s+[A-Z]|\bby\s+(?:Gage|Luigi|Chris|Jason|Walter)\s|\bset of the\b|\bpremiere\b|red carpet|press\s+junket|\bportrait of\b.*\bactor\b)/i;

/** 明显是官方形象/角色图的文件名线索 */
const CHARACTER_HINT = /(?:cover|comic|art|character|portrait|concept|render|figure.*png|\(circa|vol\.?\s*\d|#\d+)/i;
/** 明显不是角色形象的物件：实测黑寡妇条目里混进过手机照片。 */
const NON_CHARACTER_OBJECT = /(?:phone|smartphone|mobile|tablet|laptop|keyboard|blackberry|bold\s*\d|ore\b|mining|coin\b|building|tower|bridge|vehicle|food|dish|poster shop)/i;

/** Wikipedia API 最小请求间隔（实测连发会返回纯文本 "You are making too many requests"） */
// 实测 700ms 在连续 8 个角色时会触发限流（返回纯文本 "You are making too many requests"），
// 提到 1200ms 后稳定。
const WIKI_MIN_INTERVAL_MS = 1200;
let wikiNextSlot = 0;
const cache = new Map();

async function wikiThrottle() {
  const now = Date.now();
  const wait = Math.max(0, wikiNextSlot - now);
  wikiNextSlot = Math.max(now, wikiNextSlot) + WIKI_MIN_INTERVAL_MS;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function fetchJson(url, timeout = 15_000) {
  await wikiThrottle();
  const proxy = await detectProxy();
  let buf;
  if (proxy) {
    try {
      const r = await proxyFetch(url, { headers: UA, timeout });
      buf = r.buf;
    } catch { /* 回退直连 */ }
  }
  if (!buf) {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeout) });
    buf = Buffer.from(await r.arrayBuffer());
  }
  const text = buf.toString('utf8');
  // 限流时 Wikipedia 返回纯文本而非 JSON
  if (!text.trimStart().startsWith('{')) throw new Error(`Wikipedia 非 JSON 响应：${text.slice(0, 60)}`);
  return JSON.parse(text);
}

async function queryPage(title) {
  const url = `${API}?action=query&titles=${encodeURIComponent(title)}`
    + '&prop=pageimages|pageprops|images&piprop=original&imlimit=50&format=json&redirects=1';
  const data = await fetchJson(url);
  return Object.values(data?.query?.pages ?? {})[0] ?? null;
}

/** 消歧义页 → 尝试常见角色条目后缀 */
const DISAMBIG_SUFFIXES = ['(character)', '(Marvel Comics)', '(comics)', '(comic book)', '(DC Comics)'];

/**
 * 神话/通用词：维基同名条目讲的是神话或现实事物，不是漫威角色。
 * 实测 "Thor" 落到北欧神话条目，正文全是 19 世纪油画。
 */
const MYTH_OR_COMMON = new Set(['thor', 'loki', 'odin', 'hercules', 'apollo', 'ares', 'athena', 'venus', 'mars', 'jupiter', 'star-lord']);

async function resolveArticle(enTitle) {
  let page = await queryPage(enTitle);
  if (!page || page.missing) return null;

  // 神话/通用词：同名条目不是虚构角色，直接找漫威版本
  if (MYTH_OR_COMMON.has(String(enTitle).toLowerCase())) {
    for (const suffix of ['(Marvel Comics)', '(character)']) {
      const alt = await queryPage(`${enTitle} ${suffix}`);
      if (alt && !alt.missing) return alt;
    }
  }

  if (page.pageprops?.disambiguation !== '') return page;

  for (const suffix of DISAMBIG_SUFFIXES) {
    const alt = await queryPage(`${enTitle} ${suffix}`);
    if (alt && !alt.missing && alt.pageprops?.disambiguation !== '') return alt;
  }
  return null; // 全都没找到具体条目，交给上层回退
}

/**
 * 文件名与角色名的匹配分。0 表示文件名里根本没有角色名 → 视为不相关。
 *
 * 分档：
 *   1.0  文件名以角色名开头（"Gamora-cover.jpg"）
 *   0.9  文件名包含角色名且带角色图线索（cover/comic/art/…）
 *   0.6  文件名包含角色名
 *   0.2  只命中角色名的一部分（"Iron" 之于 "Iron Man"）
 *   0    完全不命中
 */
function fileNameScore(fileName, characterName) {
  const file = fileName.toLowerCase().replace(/[_]/g, ' ');
  const parts = characterName.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
  if (!parts.length) return 0;

  const full = parts.join(' ');
  const hitAll = parts.every((p) => file.includes(p));
  if (!hitAll) {
    const hitSome = parts.filter((p) => file.includes(p)).length;
    // 只命中部分词（如 "BlackBerry Bold" 之于 "Black Widow"）→ 判 0。
    // 准确性优先：宁可回退搜索，也不要拿一个只沾了半个名字的图。
    return 0;
  }

  // 正向证据：必须能说明这是一张「角色图像」，而不只是文件名里碰巧带了角色名。
  // 实测漏网案例：黑寡妇卡位出现一张手机照片 —— 文件名含 "black" 但其实是别的主题。
  const startsWithName = file.startsWith(full);
  const hasArtHint = CHARACTER_HINT.test(fileName);
  // 角色名后紧跟分隔符（"gamera-cover" / "thor (marvel comics)"）也算强证据
  const followedByDelimiter = startsWithName && /^[\s\-(_.]/.test(file.slice(full.length));

  // 明显是物件而不是角色的直接判 0
  if (NON_CHARACTER_OBJECT.test(fileName)) return 0;

  if (!hasArtHint && !followedByDelimiter) return 0;

  if (startsWithName) return 1.0;
  if (hasArtHint) return 0.9;
  return 0.6;
}

async function fileUrl(fileName) {
  const url = `${API}?action=query&titles=${encodeURIComponent(`File:${fileName}`)}`
    + '&prop=imageinfo&iiprop=url|size|mime&format=json';
  const data = await fetchJson(url);
  const page = Object.values(data?.query?.pages ?? {})[0];
  const info = page?.imageinfo?.[0];
  if (!info?.url) return null;
  return { url: info.url, width: info.width ?? 0, height: info.height ?? 0, mime: info.mime ?? '' };
}

/**
 * 取角色肖像候选（按准确率排序）。
 *
 * @param {string} enTitle 角色英文名，如 "Gamora"、"Black Panther"
 * @param {number} count 返回上限
 * @returns {Promise<Array<{url, fallbackUrl, title, author, license, page, accuracy, width, height}>>}
 */
export async function wikipediaCharacterPortraitCandidates(enTitle, count = 3) {
  const key = String(enTitle ?? '').trim();
  if (!key) return [];
  if (cache.has(key)) return cache.get(key).slice(0, count + 2);

  let page;
  try {
    page = await resolveArticle(key);
  } catch (e) {
    // 限流是暂时性的：等久一点重试一次，仍失败才放弃（并**不**缓存空结果，
    // 否则一次限流会让该角色在整个进程生命周期内都没有肖像）。
    try {
      await new Promise((r) => setTimeout(r, 3000));
      page = await resolveArticle(key);
    } catch {
      return [];
    }
    if (!page) return [];
  }
  if (!page) { cache.set(key, []); return []; }

  const files = (page.images ?? [])
    .map((i) => String(i.title ?? '').replace(/^File:/, ''))
    .filter((f) => f && !NON_CONTENT_FILE.test(f) && !ACTOR_FILE.test(f));

  const scored = files
    .map((f) => ({ f, score: fileNameScore(f, key) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const out = [];
  for (const { f, score } of scored) {
    if (out.length >= count + 2) break;
    let info;
    try { info = await fileUrl(f); } catch { continue; }
    if (!info) continue;
    // 只要位图；SVG 是矢量图，与「要照片」的诉求不符
    if (!/^image\/(?:jpeg|png|webp)$/i.test(info.mime)) continue;
    // 卡片位最小可用尺寸：比搜索路径宽松（准确率优先于分辨率）
    // 漫画封面常是窄条（实测 Captain America.png 只有 191x522），
    // 但短边 150+ 已足够卡片位显示；准确率优先于分辨率，这里放宽门槛。
    if (Math.min(info.width, info.height) < 150) continue;
    out.push({
      url: info.url,
      fallbackUrl: null,
      title: `${page.title} · ${f.replace(/\.[a-z]+$/i, '').replace(/[_]/g, ' ')}`,
      author: 'Wikipedia',
      license: 'via Wikipedia (en)',
      page: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(page.title).replace(/ /g, '_'))}`,
      accuracy: score,
      width: info.width,
      height: info.height,
    });
  }
  cache.set(key, out);
  return out;
}

/** 供测试重置节流与缓存 */
export function __resetWikiPortraitState() {
  wikiNextSlot = 0;
  cache.clear();
}
