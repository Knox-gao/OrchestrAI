/**
 * 风格引擎：148 种视觉风格的组合式目录（参考 stylekit.top 分类学）。
 * 结构 = 16 个精工基底 × 9 种色彩气质 + 4 个工作室联名 = 148。
 * 基底负责工艺（字体/卡片质感/特效），色彩由 HSL 引擎按明/暗模式程序化派生。
 */

/* ---------- HSL 工具 ---------- */
function hslToRgb(h, s, l) {
  // 入参约定：s/l 为 0..1 小数
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
const hsl = (h, s, l) => `hsl(${h} ${s}% ${l}%)`;

/* ---------- 9 种色彩气质 ---------- */
const PALETTES = [
  { id: 'obsidian', name: '曜黑', h: 222, s: 14, ah: 168, as: 84, al: 62 },
  { id: 'crimson', name: '绯红', h: 352, s: 48, ah: 352, as: 78, al: 56 },
  { id: 'tangerine', name: '蜜橙', h: 26, s: 50, ah: 26, as: 92, al: 56 },
  { id: 'aurum', name: '鎏金', h: 40, s: 42, ah: 42, as: 82, al: 52 },
  { id: 'jade', name: '青翠', h: 158, s: 36, ah: 158, as: 64, al: 46 },
  { id: 'azure', name: '天青', h: 205, s: 52, ah: 200, as: 86, al: 58 },
  { id: 'amethyst', name: '紫晶', h: 262, s: 40, ah: 262, as: 72, al: 66 },
  { id: 'blossom', name: '桃粉', h: 336, s: 44, ah: 336, as: 84, al: 66 },
  { id: 'moss', name: '苔绿', h: 96, s: 26, ah: 96, as: 42, al: 44 },
];

const FONT_SANS = `'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif`;
const FONT_SERIF = `Georgia, 'Times New Roman', 'STSong', 'SimSun', serif`;
const FONT_MONO = `'Cascadia Code', Consolas, 'Courier New', monospace`;

/* ---------- 16 个精工基底 ---------- */
const BASES = [
  {
    id: 'neon', name: '暗夜霓虹', mode: 'dark', radius: '14px', font: FONT_SANS,
    keywords: ['霓虹', '赛博', 'cyberpunk', 'neon', '科技感', '夜'],
    extra: `body::before { content:''; position:fixed; inset:0; pointer-events:none;
  background: radial-gradient(900px 420px at 50% -120px, rgba(var(--accent-rgb), .1), transparent 70%); }
header h1 span { text-shadow: 0 0 22px rgba(var(--accent-rgb), .8); }
.card { box-shadow: 0 8px 32px rgba(0,0,0,.35); }`,
  },
  {
    id: 'brutalist', name: '新野兽派', mode: 'light', radius: '0px', font: FONT_SANS,
    keywords: ['野兽派', 'brutalist', '粗犷', '波普'],
    extra: `.card { border: 3px solid var(--ink); box-shadow: 7px 7px 0 var(--ink); }
button { border: 3px solid var(--ink) !important; box-shadow: 4px 4px 0 var(--ink); border-radius: 0 !important; font-weight: 800; }
button:hover { transform: translate(2px,2px); box-shadow: 2px 2px 0 var(--ink); }
header h1 { text-transform: none; letter-spacing: -1px; }
header h1 span { background: var(--accent); color: var(--ink); padding: 0 10px; box-shadow: 4px 4px 0 var(--ink); }
input, textarea, select { border: 3px solid var(--ink); border-radius: 0; font-weight: 600; }`,
  },
  {
    id: 'editorial', name: '编辑杂志', mode: 'light', radius: '2px', font: FONT_SERIF,
    keywords: ['杂志', '编辑', 'editorial', '报刊', '人文'],
    extra: `header h1 { font-size: 34px; letter-spacing: .5px; }
header p { font-style: italic; }
.card { border-top: 3px solid var(--accent); box-shadow: none; }
button { text-transform: uppercase; letter-spacing: 2px; font-size: 12px; font-family: ${FONT_SANS}; }`,
  },
  {
    id: 'neumorph', name: '新拟物派', mode: 'light', radius: '18px', font: FONT_SANS,
    keywords: ['拟物', '拟态', 'neumorphism', '柔影', '软装'],
    extra: `.card { background: var(--bg); border: none;
  box-shadow: 9px 9px 18px var(--nm-dark), -9px -9px 18px var(--nm-light); }
button { background: var(--bg); border: none; box-shadow: 5px 5px 10px var(--nm-dark), -5px -5px 10px var(--nm-light); }
button:hover { color: var(--accent); }
button:active, button.primary { box-shadow: inset 4px 4px 8px var(--nm-dark), inset -4px -4px 8px var(--nm-light); }
input, textarea, select { background: var(--bg); box-shadow: inset 4px 4px 8px var(--nm-dark), inset -4px -4px 8px var(--nm-light); border: none; }`,
  },
  {
    id: 'glass', name: '毛玻璃', mode: 'dark', radius: '18px', font: FONT_SANS,
    keywords: ['玻璃', '毛玻璃', 'glass', '通透', '苹果风', 'macos'],
    extra: `.card { background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.16);
  backdrop-filter: blur(18px) saturate(150%); -webkit-backdrop-filter: blur(18px) saturate(150%); }
button { background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.18); backdrop-filter: blur(10px); }
button.primary { background: rgba(var(--accent-rgb), .22); }
input, textarea, select { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.16); }`,
  },
  {
    id: 'clay', name: '粘土拟态', mode: 'light', radius: '26px', font: FONT_SANS,
    keywords: ['粘土', 'clay', '可爱', '软萌', '3d'],
    extra: `.card { box-shadow: 0 14px 28px var(--clay-sh), inset 0 -6px 12px var(--clay-in), inset 0 6px 8px #fff; }
button { border: none; box-shadow: 0 8px 16px var(--clay-sh), inset 0 -5px 10px var(--clay-in); font-weight: 700; }
button:hover { transform: translateY(-2px); }
button:active { transform: translateY(2px); box-shadow: inset 0 5px 10px var(--clay-in); }`,
  },
  {
    id: 'aurora', name: '极光渐变', mode: 'dark', radius: '20px', font: FONT_SANS,
    keywords: ['极光', '渐变', 'aurora', 'gradient', '梦幻', '星云'],
    extra: `body::before { content:''; position:fixed; inset:-20%; pointer-events:none; z-index:-1;
  background:
    radial-gradient(38% 42% at 18% 24%, rgba(var(--accent-rgb),.32), transparent 60%),
    radial-gradient(34% 40% at 82% 30%, hsl(calc(var(--ah) + 70) 80% 60% / .26), transparent 60%),
    radial-gradient(42% 46% at 50% 88%, hsl(calc(var(--ah) - 60) 80% 58% / .22), transparent 62%);
  filter: blur(38px); animation: drift 16s ease-in-out infinite alternate; }
@keyframes drift { to { transform: translate(3%, -4%) scale(1.06) rotate(2deg); } }
.card { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.14); backdrop-filter: blur(14px); }
button.primary { background: linear-gradient(135deg, rgba(var(--accent-rgb),.4), transparent); }`,
  },
  {
    id: 'retro', name: '复古报纸', mode: 'light', radius: '3px', font: FONT_MONO,
    keywords: ['复古', '怀旧', '报纸', '打字机', 'retro', 'vintage', '旧'],
    extra: `body { background-image: repeating-linear-gradient(0deg, rgba(0,0,0,.025) 0 1px, transparent 1px 4px); }
.card { border: 2px dashed var(--ink-soft); background: var(--panel); }
header h1 { font-size: 30px; }
header h1 span { border: 2px solid var(--ink); padding: 0 8px; }
button { border: 2px solid var(--ink); border-radius: 0; font-family: ${FONT_MONO}; }
.empty::before { content: '※ '; }`,
  },
  {
    id: 'terminal', name: '终端绿屏', mode: 'dark', radius: '4px', font: FONT_MONO,
    keywords: ['终端', '命令行', '黑客', 'terminal', 'console', '码农'],
    extra: `body { background: radial-gradient(80% 60% at 50% 0%, hsl(var(--ah) 40% 8%), #040704 80%); }
* { font-family: ${FONT_MONO} !important; }
.card { border: 1px solid hsl(var(--ah) 50% 22%); box-shadow: 0 0 24px hsl(var(--ah) 80% 30% / .25) inset; }
header h1 span::before { content: '> '; }
header h1 span { text-shadow: 0 0 12px var(--accent); animation: caret 1.1s steps(1) infinite; }
@keyframes caret { 50% { opacity: .55; } }
button { border: 1px solid var(--accent); color: var(--accent); text-shadow: 0 0 8px rgba(var(--accent-rgb),.6); }`,
  },
  {
    id: 'pixel', name: '像素游戏', mode: 'dark', radius: '0px', font: FONT_MONO,
    keywords: ['像素', '游戏', '8bit', 'pixel', '复古游戏'],
    extra: `.card { border: 4px solid var(--ink); box-shadow: 0 0 0 4px var(--panel-2), 8px 8px 0 4px rgba(0,0,0,.5); image-rendering: pixelated; }
button { border: 4px solid var(--ink); border-radius: 0; box-shadow: 4px 4px 0 var(--ink); font-family: ${FONT_MONO}; font-weight: 800; }
button:active { transform: translate(4px,4px); box-shadow: none; }
header h1 span { image-rendering: pixelated; text-shadow: 3px 3px 0 var(--ink); }
img { image-rendering: pixelated; }`,
  },
  {
    id: 'zen', name: '和风禅意', mode: 'light', radius: '6px', font: FONT_SERIF,
    keywords: ['和风', '禅', '日式', 'zen', '侘寂', '素雅'],
    extra: `.card { box-shadow: 0 1px 3px rgba(0,0,0,.06); border: none; border-left: 3px solid var(--accent); padding: 22px 24px; }
header h1 { font-weight: 400; letter-spacing: 8px; }
header h1 span { color: var(--accent); }
button { border-radius: 2px; letter-spacing: 4px; font-family: ${FONT_SERIF}; }
.empty { letter-spacing: 4px; }`,
  },
  {
    id: 'luxe', name: '鎏金奢华', mode: 'dark', radius: '10px', font: FONT_SERIF,
    keywords: ['奢华', '高级', '金', 'luxury', 'luxe', '会所', '贵族'],
    extra: `.card { border: 1px solid rgba(var(--accent-rgb), .35);
  background: linear-gradient(160deg, rgba(255,255,255,.04), transparent 50%), var(--panel);
  box-shadow: 0 20px 50px rgba(0,0,0,.5); }
header h1 { font-weight: 600; letter-spacing: 3px; }
header h1 span { background: linear-gradient(120deg, var(--accent), #fff2c4 50%, var(--accent));
  -webkit-background-clip: text; background-clip: text; color: transparent; }
button.primary { border-color: var(--accent); background: rgba(var(--accent-rgb), .12); }`,
  },
  {
    id: 'corporate', name: '企业简洁', mode: 'light', radius: '10px', font: FONT_SANS,
    keywords: ['企业', '商务', '专业', 'corporate', '办公', '后台'],
    extra: `header { text-align: left; border-bottom: 2px solid var(--border); padding-bottom: 16px; }
header h1 span { color: var(--accent); }
.card { box-shadow: 0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.1); }
button.primary { color: #fff; background: var(--accent); border-color: var(--accent); }`,
  },
  {
    id: 'notion', name: 'Notion 风', mode: 'light', radius: '6px', font: FONT_SANS,
    keywords: ['notion', '笔记风', '文档', '知识库'],
    extra: `.card { border: 1px solid var(--border); box-shadow: 0 0 4px rgba(15,15,15,.04); }
header h1 span { background: rgba(var(--accent-rgb), .25); border-radius: 4px; padding: 0 6px; }
button { background: #f7f7f5; border: 1px solid #e3e2e0; }
button.primary { background: var(--ink); color: #fff; border-color: var(--ink); }`,
  },
  {
    id: 'soft', name: '柔和界面', mode: 'light', radius: '22px', font: FONT_SANS,
    keywords: ['柔和', 'soft', '清新', '奶油', '治愈'],
    extra: `.card { box-shadow: 0 10px 30px var(--soft-sh); border: none; }
button { border: none; box-shadow: 0 6px 14px var(--soft-sh); font-weight: 600; }
button:hover { transform: translateY(-1px); }
input, textarea, select { border: none; box-shadow: 0 4px 14px var(--soft-sh); }`,
  },
  {
    id: 'organic', name: '自然有机', mode: 'light', radius: '28px 14px 26px 12px', font: FONT_SANS,
    keywords: ['自然', '有机', '植物', 'organic', '森林', '环保'],
    extra: `.card { border: none; box-shadow: 0 12px 26px var(--soft-sh); }
header h1 span { color: var(--accent); }
button { border-radius: 999px; }
input, textarea, select { border-radius: 999px; }`,
  },
];

/* ---------- 目录合成：16 × 9 + 4 联名 = 148 ---------- */
const COLLABS = [
  { id: 'studio-sig', name: '工作室签名·曜黑', base: 'neon', palette: 'obsidian', signature: true },
  { id: 'studio-gold', name: '工作室签名·鎏金', base: 'luxe', palette: 'aurum', signature: true },
  { id: 'studio-void', name: '工作室签名·虚空', base: 'terminal', palette: 'amethyst', signature: true },
  { id: 'studio-paper', name: '工作室签名·纸墨', base: 'retro', palette: 'moss', signature: true },
];

export const CATALOG = [];
for (const base of BASES) {
  for (const pal of PALETTES) {
    CATALOG.push({ id: `${base.id}-${pal.id}`, name: `${pal.name}·${base.name}`, base: base.id, palette: pal.id });
  }
}
for (const c of COLLABS) CATALOG.push(c);
export const STYLE_COUNT = CATALOG.length; // 148

export function findStyle(id) {
  return CATALOG.find((s) => s.id === id) ?? null;
}

/** 从一句话里识别风格（基底关键词命中 + 色彩词命中） */
export function detectStyle(sentence) {
  const s = String(sentence ?? '').toLowerCase();
  let hitBase = null;
  for (const base of BASES) {
    if (base.keywords.some((k) => s.includes(k.toLowerCase()))) { hitBase = base; break; }
  }
  let hitPal = null;
  const colorWords = [
    ['绯红', 'crimson'], ['红', 'crimson'], ['橙', 'tangerine'], ['蜜橙', 'tangerine'],
    ['金', 'aurum'], ['鎏金', 'aurum'], ['青翠', 'jade'], ['绿', 'jade'],
    ['天青', 'azure'], ['蓝', 'azure'], ['紫晶', 'amethyst'], ['紫', 'amethyst'],
    ['桃粉', 'blossom'], ['粉', 'blossom'], ['苔绿', 'moss'], ['黑', 'obsidian'],
  ];
  for (const [word, id] of colorWords) {
    if (s.includes(word)) { hitPal = PALETTES.find((p) => p.id === id); break; }
  }
  if (!hitBase && !hitPal) return null;
  const baseId = hitBase ? hitBase.id : 'neon';
  const palId = hitPal ? hitPal.id : 'obsidian';
  return `${baseId}-${palId}`;
}

/* ---------- 自由文字风格描述：五维特征解析 ---------- */

const HUE_WORDS = [
  ['红', 352], ['赤', 358], ['橙', 26], ['橘', 30], ['黄', 46], ['金', 42],
  ['绿', 150], ['青', 185], ['蓝', 210], ['紫', 268], ['粉', 336],
  ['樱色', 340], ['咖啡', 24], ['棕', 24], ['灰', 220],
];

/**
 * 解析用户的风格文字描述 → 特征。
 * @returns {{baseId:string|null, paletteId:string|null, dark:boolean|null,
 *            accentHsl:[h,s,l]|null, radius:string|null, font:'serif'|'mono'|'sans'|null, text:string}}
 */
export function parseStyleDescription(desc) {
  const s = String(desc ?? '').toLowerCase();
  if (!s.trim()) return null;
  const out = { baseId: null, paletteId: null, dark: null, accentHsl: null, radius: null, font: null, text: String(desc).trim().slice(0, 120) };

  // 1) 质感/流派 → 基底
  for (const base of BASES) {
    if (base.keywords.some((k) => s.includes(k.toLowerCase()))) { out.baseId = base.id; break; }
  }
  // 2) 色彩：十六进制色值 > 色相词
  const hex = s.match(/#([0-9a-f]{6})\b/);
  if (hex) {
    const n = parseInt(hex[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
    let h = 0;
    const l = (max + min) / 2;
    const d = max - min;
    if (d > 0) {
      if (max === r / 255) h = ((g - b) / d / 255) % 6;
      else if (max === g / 255) h = (b - r) / d / 255 + 2;
      else h = (r - g) / d / 255 + 4;
      h = Math.round(((h * 60) + 360) % 360);
    }
    out.accentHsl = [h, Math.round(d / Math.max(max, 0.001) * 70) + 20, Math.round(l * 100)];
  } else {
    for (const [word, hue] of HUE_WORDS) {
      if (s.includes(word)) { out.accentHsl = [hue, 72, 55]; break; }
    }
  }
  // 3) 明暗
  if (/深色|暗色|黑夜|深底|dark/.test(s)) out.dark = true;
  else if (/浅色|亮色|白底|日间|light|明亮/.test(s)) out.dark = false;
  // 4) 圆角
  if (/圆润|圆角|胶囊|软/.test(s)) out.radius = '20px';
  else if (/直角|锐利|方正|硬朗/.test(s)) out.radius = '0px';
  // 5) 字体
  if (/衬线|宋体|杂志|书卷/.test(s)) out.font = 'serif';
  else if (/等宽|代码|终端/.test(s)) out.font = 'mono';
  // 6) 背景色相：显式"X底/X背景/X调背景"（主题氛围底色，与强调色独立）
  const bgm = s.match(/(红|橙|黄|金|绿|青|蓝|紫|粉|棕|咖啡)[色调深暗亮浅]{0,3}(背景|底色|底)(?![方本])/) || s.match(/(红|橙|黄|金|绿|青|蓝|紫|粉|棕|咖啡)[^，。;,]{0,4}(背景|底)/);
  if (bgm) {
    const hitHue = HUE_WORDS.find(([w]) => w === bgm[1] || (bgm[1] + '色') === w);
    if (hitHue) out.bgHue = hitHue[1];
  }
  return out;
}

/** 色彩气质里出现过的风格词，供主题词清洗 */
export function styleWordsRegex() {
  const words = [];
  for (const base of BASES) words.push(...base.keywords);
  words.push('风格', '样式', 'style', '版式');
  return new RegExp(words.join('|'), 'gi');
}

/**
 * 解析完整风格定义（CSS 变量 + 工艺 CSS + 强调色）。
 * spec.styleId 命中目录则用之；否则用默认（暗夜霓虹 × 模板原强调色）。
 */
export function getStyleDef(spec) {
  let entry = spec?.styleId ? findStyle(spec.styleId) : null;
  const templateAccent = spec?.template?.meta?.accent ?? '#00f5d4';

  // 自由文字描述：六维特征 → 最近目录项 + 自定义覆盖
  const descParsed = spec?.styleDescription ? parseStyleDescription(spec.styleDescription) : null;
  if (!entry && descParsed) {
    // 基底智能选择：描述命中基底词用之；否则按明暗+质感派（浅色不再误挂"暗夜霓虹"名）
    let baseId = descParsed.baseId;
    if (!baseId) {
      if (descParsed.dark === false) {
        baseId = descParsed.font === 'serif' ? 'editorial'
          : descParsed.radius === '20px' ? 'clay'
          : descParsed.font === 'mono' ? 'retro' : 'corporate';
      } else {
        baseId = descParsed.font === 'serif' ? 'luxe' : 'neon';
      }
    }
    const palId = descParsed.paletteId ?? 'obsidian';
    entry = findStyle(`${baseId}-${palId}`);
  }

  if (!entry) {
    // 默认：保留每个模板原有的强调色（向后兼容）
    const m = templateAccent.replace('#', '');
    const rgb = [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
    return {
      id: 'auto', name: '自动（暗夜霓虹）', accent: templateAccent, accentRgb: rgb.join(','),
      vars: defaultVars(), extraCss: BASES[0].extra, radius: BASES[0].radius, font: BASES[0].font,
    };
  }

  const base = BASES.find((b) => b.id === entry.base);
  const pal = PALETTES.find((p) => p.id === entry.palette);
  const accent = hsl(pal.ah, pal.as, base.mode === 'dark' ? pal.al : Math.max(28, pal.al - 22));
  const rgb = hslToRgb(pal.ah, pal.as / 100, (base.mode === 'dark' ? pal.al : Math.max(28, pal.al - 22)) / 100);
  const dark = base.mode === 'dark';
  let vars = {
    '--ah': String(pal.ah),
    ...(dark
      ? {
          '--bg': hsl(pal.h, Math.min(30, pal.s), 7), '--panel': hsl(pal.h, Math.min(28, pal.s), 12),
          '--panel-2': hsl(pal.h, Math.min(26, pal.s), 16), '--border': hsl(pal.h, Math.min(24, pal.s), 25),
          '--text': '#eaedf4', '--text-dim': 'rgba(234,237,244,.62)', '--text-faint': 'rgba(234,237,244,.4)',
          '--ink': '#0a0c14', '--ink-soft': hsl(pal.h, 12, 32),
          '--nm-dark': 'rgba(0,0,0,.28)', '--nm-light': 'rgba(255,255,255,.5)',
          '--clay-sh': hsl(pal.h, 40, 72), '--clay-in': hsl(pal.h, 46, 62),
          '--soft-sh': hsl(pal.h, 38, 80),
        }
      : {
          '--bg': hsl(pal.h, Math.min(38, pal.s), 95), '--panel': '#ffffff',
          '--panel-2': hsl(pal.h, Math.min(30, pal.s), 93), '--border': hsl(pal.h, Math.min(24, pal.s), 85),
          '--text': '#1d202b', '--text-dim': 'rgba(29,32,43,.58)', '--text-faint': 'rgba(29,32,43,.4)',
          '--ink': '#15171f', '--ink-soft': hsl(pal.h, 14, 55),
          '--nm-dark': 'rgba(163,177,198,.55)', '--nm-light': '#ffffff',
          '--clay-sh': hsl(pal.h, 38, 78), '--clay-in': hsl(pal.h, 44, 66),
          '--soft-sh': hsl(pal.h, 36, 84),
        }),
  };
  // 自定义覆盖层（来自用户文字描述）
  let accentFinal = accent, rgbFinal = rgb;
  let radiusFinal = base.radius, fontFinal = base.font;
  let darkFinal = base.mode === 'dark';
  let custom = false;
  if (descParsed) {
    if (descParsed.accentHsl) {
      const [h, sat, li] = descParsed.accentHsl;
      const liAdj = darkFinal ? li : Math.max(30, li - 20);
      accentFinal = hsl(h, sat, liAdj);
      rgbFinal = hslToRgb(h, sat / 100, liAdj / 100);
      custom = true;
    }
    if (descParsed.dark !== null && descParsed.dark !== darkFinal) {
      // 明暗翻转：用同一色相重新派生一套变量
      const flipped = descParsed.dark;
      const v = flipped
        ? {
            '--bg': hsl(pal.h, Math.min(30, pal.s), 7), '--panel': hsl(pal.h, Math.min(28, pal.s), 12),
            '--panel-2': hsl(pal.h, Math.min(26, pal.s), 16), '--border': hsl(pal.h, Math.min(24, pal.s), 25),
            '--text': '#eaedf4', '--text-dim': 'rgba(234,237,244,.62)', '--text-faint': 'rgba(234,237,244,.4)',
            '--ink': '#0a0c14', '--ink-soft': hsl(pal.h, 12, 32),
            '--nm-dark': 'rgba(0,0,0,.28)', '--nm-light': 'rgba(255,255,255,.5)',
            '--clay-sh': hsl(pal.h, 40, 72), '--clay-in': hsl(pal.h, 46, 62), '--soft-sh': hsl(pal.h, 38, 80),
          }
        : {
            '--bg': hsl(pal.h, Math.min(38, pal.s), 95), '--panel': '#ffffff',
            '--panel-2': hsl(pal.h, Math.min(30, pal.s), 93), '--border': hsl(pal.h, Math.min(24, pal.s), 85),
            '--text': '#1d202b', '--text-dim': 'rgba(29,32,43,.58)', '--text-faint': 'rgba(29,32,43,.4)',
            '--ink': '#15171f', '--ink-soft': hsl(pal.h, 14, 55),
            '--nm-dark': 'rgba(163,177,198,.55)', '--nm-light': '#ffffff',
            '--clay-sh': hsl(pal.h, 38, 78), '--clay-in': hsl(pal.h, 44, 66), '--soft-sh': hsl(pal.h, 36, 84),
          };
      vars = { ...vars, ...v };
      darkFinal = flipped;
      if (descParsed.accentHsl) {
        const [h, sat, li] = descParsed.accentHsl;
        accentFinal = hsl(h, sat, flipped ? li : Math.max(30, li - 20));
        rgbFinal = hslToRgb(h, sat / 100, (flipped ? li : Math.max(30, li - 20)) / 100);
      }
      custom = true;
    }
    if (descParsed.radius) { radiusFinal = descParsed.radius; custom = true; }
    if (descParsed.font) { fontFinal = descParsed.font === 'serif' ? FONT_SERIF : descParsed.font === 'mono' ? FONT_MONO : FONT_SANS; custom = true; }
    // 6) 背景色相：显式描述优先；AI 设计简报（spec.styleDesign）默认用主色相做沉浸底色
    let bgHue = descParsed.bgHue ?? null;
    if (bgHue === null && spec?.styleDesign && descParsed.accentHsl) bgHue = descParsed.accentHsl[0];
    if (bgHue !== null) {
      const bh = bgHue;
      vars = { ...vars, ...(darkFinal
        ? {
            '--bg': hsl(bh, 32, 6), '--panel': hsl(bh, 28, 10), '--panel-2': hsl(bh, 26, 14),
            '--border': hsl(bh, 24, 22), '--ink': hsl(bh, 24, 4), '--ink-soft': hsl(bh, 14, 30),
          }
        : {
            '--bg': hsl(bh, 44, 94), '--panel': '#ffffff', '--panel-2': hsl(bh, 32, 92),
            '--border': hsl(bh, 24, 84), '--ink': hsl(bh, 20, 12), '--ink-soft': hsl(bh, 14, 52),
          }) };
      custom = true;
    }
  }

  const designName = spec?.styleDesign
    ? `AI 设计 · ${base.name}`
    : (custom ? `自定义 · ${entry.name}` : entry.name);
  return {
    id: entry.id, name: designName,
    accent: accentFinal, accentRgb: rgbFinal.join(','),
    vars, extraCss: base.extra, radius: radiusFinal, font: fontFinal,
  };
}

function defaultVars() {
  return {
    '--ah': '168',
    '--bg': '#0f1226', '--panel': '#181d33', '--panel-2': '#1e2440', '--border': '#2a3354',
    '--text': '#e8ecf5', '--text-dim': '#9aa5c0', '--text-faint': '#5a6b8c',
    '--ink': '#0a0c14', '--ink-soft': '#2c3452',
    '--nm-dark': 'rgba(0,0,0,.28)', '--nm-light': 'rgba(255,255,255,.5)',
    '--clay-sh': '#d8cfc2', '--clay-in': '#c9bdaa', '--soft-sh': '#e8e2d8',
  };
}

/** 给 pwa/图标用：主题色（含自动模式） */
export function styleAccentOf(spec) {
  return getStyleDef(spec).accent;
}
