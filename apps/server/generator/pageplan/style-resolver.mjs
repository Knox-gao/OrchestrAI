/**
 * PagePlan ← 官方风格注册表 的桥接层（M7-B4B 生产集成必需）
 *
 * 候选包只能校验 `theme.styleId` 字符串是否一致，无法证明颜色/字体语义真的来自该风格。
 * 本模块从 styles.mjs 的 getStyleDef() 取**真实令牌**，归一化为 PagePlan theme 需要的 #RRGGBB。
 *
 * 设计要点：
 * - 不接受模型编造的 styleId：必须先经 canonicalStyleId() 映射到注册表内的真实 ID
 * - 所有颜色在这里解析成 hex（风格定义给的是 hsl()/rgba()），渲染器只收 hex
 * - fontMood 决定字体栈（serif/sans/mono），并覆盖风格自带 font
 */

/** hsl(h s% l%) / rgba(r,g,b,a) / #hex → #rrggbb（失败返回 null） */
export function toHex(color) {
  const raw = String(color ?? '').trim();
  const hex = /^#([0-9a-fA-F]{6})$/.exec(raw);
  if (hex) return '#' + hex[1].toLowerCase();
  const short = /^#([0-9a-fA-F]{3})$/.exec(raw);
  if (short) return '#' + short[1].split('').map((c) => c + c).join('').toLowerCase();

  const hsl = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/i.exec(raw);
  if (hsl) {
    const h = ((Number(hsl[1]) % 360) + 360) % 360 / 360;
    const s = Math.min(1, Number(hsl[2]) / 100);
    const l = Math.min(1, Number(hsl[3]) / 100);
    if (s === 0) { const v = Math.round(l * 255); return rgbHex(v, v, v); }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    // hue2rgb 返回 0..1 归一化值，rgbHex 需要 0..255
    return rgbHex(
      hue2rgb(p, q, h + 1 / 3) * 255,
      hue2rgb(p, q, h) * 255,
      hue2rgb(p, q, h - 1 / 3) * 255,
    );
  }

  const rgba = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(raw);
  if (rgba) return rgbHex(Number(rgba[1]), Number(rgba[2]), Number(rgba[3]));

  return null;
}

function hue2rgb(p, q, t) {
  let x = t;
  if (x < 0) x += 1;
  if (x > 1) x -= 1;
  if (x < 1 / 6) return p + (q - p) * 6 * x;
  if (x < 1 / 2) return q;
  if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
  return p;
}
function rgbHex(r, g, b) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}

/** 相对亮度对比（用于挑选可读的 accentSoft） */
function luminance(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** 与某个 hex 混合出柔和色（ratio 0..1 越大越接近 base） */
function mixHex(a, b, ratio) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (shift) => {
    const va = (pa >> shift) & 255, vb = (pb >> shift) & 255;
    return Math.round(va * ratio + vb * (1 - ratio));
  };
  return rgbHex(ch(16), ch(8), ch(0));
}

const FONT_STACK = {
  serif: "'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Georgia, serif",
  sans: "Inter, 'Segoe UI', Arial, sans-serif",
  mono: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
};

/** 由风格 radius 字符串（18px / 0px / 2px…）推导 PagePlan radius 枚举 */
export function radiusEnumOf(radiusCss) {
  const px = Number(String(radiusCss ?? '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(px) || px <= 2) return 'sharp';
  if (px <= 8) return 'soft';
  if (px <= 20) return 'rounded';
  return 'pill';
}

/**
 * 把用户可能给的（可能是风格的"名称"或旧别名）映射成注册表里的真实 ID。
 * 例：pink-neumorph（模型编造）→ neumorph-blossom（桃粉·新拟物派）
 * @param {string} raw
 * @param {Array<{id:string,name:string}>} catalog
 */
export function canonicalStyleId(raw, catalog) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const ids = new Set((catalog ?? []).map((c) => c.id));
  if (ids.has(s)) return s;

  // 1) 名称精确匹配（含"桃粉·新拟物派"这种 label）
  const byName = (catalog ?? []).find((c) => c.name === s);
  if (byName) return byName.id;

  // 2) 词元交集打分：pink-neumorph → 命中 blossom + neumorph
  const tokens = s.toLowerCase().split(/[-_\s·]+/).filter((t) => t.length >= 3);
  if (tokens.length === 0) return null;
  const ALIAS = { pink: 'blossom', rose: 'blossom', gold: 'aurum', dark: 'obsidian', night: 'obsidian', green: 'jade', blue: 'azure', purple: 'amethyst' };
  const expanded = new Set(tokens.flatMap((t) => [t, ALIAS[t]].filter(Boolean)));
  let best = null, bestScore = 0;
  for (const c of catalog ?? []) {
    const cid = c.id.toLowerCase();
    let score = 0;
    for (const t of expanded) if (cid.includes(t)) score += t.length;
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return bestScore > 0 ? best.id : null;
}

/**
 * 解析 PagePlan theme tokens（全部为 #RRGGBB / 枚举），来源是真实风格定义。
 * @param {{styleId:string, fontMood?:'serif'|'sans'|'mono', getStyleDef:Function, catalog:Array, direction?:string}} opts
 */
export function resolveThemeTokens({ styleId, fontMood, getStyleDef, catalog, direction }) {
  const canonical = canonicalStyleId(styleId, catalog);
  if (!canonical) throw new Error(`未知风格 ID：${styleId}（且无法映射到注册表）`);

  const def = getStyleDef({ styleId: canonical, template: { meta: {} } });
  if (!def) throw new Error(`风格 ${canonical} 解析失败`);
  const v = def.vars ?? {};

  const background = toHex(v['--bg']) ?? '#ffffff';
  const surface = toHex(v['--panel']) ?? background;
  const text = toHex(v['--text']) ?? '#111111';
  const muted = toHex(v['--text-dim']) ?? mixHex(text, background, 0.55);
  const accent = toHex(def.accent) ?? toHex(v['--ah']) ?? '#1a1a1a';
  const accentSoft = mixHex(accent, background, 0.18);

  // 深色底 → 用浅色文字（PagePlan 渲染器固定 color-scheme:light，所以这里只保证对比度）
  const bgLum = luminance(background);
  const textHex = bgLum < 0.2 ? '#f2f2f2' : '#15171f';
  const mutedHex = bgLum < 0.2 ? mixHex(textHex, background, 0.62) : mixHex(textHex, background, 0.58);

  return {
    styleId: canonical,
    background,
    surface,
    text: textHex,
    muted: mutedHex,
    accent,
    accentSoft,
    fontMood: fontMood ?? 'sans',
    density: direction === 'explore' ? 'airy' : direction === 'dashboard' ? 'compact' : 'comfortable',
    radius: radiusEnumOf(def.radius),
  };
}

export function fontStackOf(fontMood) {
  return FONT_STACK[fontMood] ?? FONT_STACK.sans;
}
