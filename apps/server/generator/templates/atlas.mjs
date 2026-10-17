/** 模板：沉浸图谱（Atlas）v3 档案馆级 —— 程序化行星纹理 / 光环 / 日冕 / 银河星域 / 拖尾轨道 / 等宽档案排版（对标 solar-system-atlas） */
import { buildThemeCss, pageShell } from '../theme.mjs';
import { getStyleDef } from '../styles.mjs';

export const meta = {
  type: 'atlas',
  name: '沉浸图谱',
  keywords: ['图谱', '三维', '3d', '沉浸', '星图', '可视化', 'atlas', '时间线', '演变', '全系', '博物馆', '太阳系', '行星'],
  accent: '#d4b784', accentRgb: '212,183,132',
  features: ['档案馆级三维星图（程序化行星纹理/光环/日冕/银河星域）', '拖拽旋转 / 滚轮缩放 / 悬停 / 点击聚焦 / 触屏支持', '档案卡信息面板 + 底部对象条 + 时间轴回放', '搜索高亮 + 进场运镜 + 闲置巡航'],
};

export function files(spec) {
  const raw = spec.atlas ?? {};
  const objs = raw.objects ?? [];
  const norm = objs.map((o, i) => ({
    ...o,
    orbit: typeof o.orbit === 'number' ? Math.max(0, Math.min(1, o.orbit)) : (objs.length <= 1 ? 0 : i / (objs.length - 1)),
    size: typeof o.size === 'number' ? Math.max(2, Math.min(11, o.size)) : 4 + (i % 3),
    color: /^#[0-9a-fA-F]{6}$/.test(String(o.color)) ? o.color : null,
  }));
  const A = {
    theme: raw.theme ?? spec.title,
    unitLabel: raw.unitLabel ?? '年份',
    meta: { via: spec.viaLLM ? 'AI 联网整理 · ' + (spec.llmProvider || 'LLM') : 'OrchestrAI 示例数据' },
    objects: norm.length >= 1 ? norm : [
      { name: '示例中心', sub: 'OrchestrAI', desc: '配置模型后由 AI 联网生成真实主题数据集。', year: 2026, metric: 0, metricLabel: '—', orbit: 0, size: 11, color: '#ffd166' },
      { name: '示例对象', sub: 'OrchestrAI', desc: '试试「法拉利历代经典车图谱」「太阳系行星图鉴」。', year: 2026, metric: 0, metricLabel: '—', orbit: 0.5, size: 5, color: '#7dd3fc' },
    ],
  };

  const logic = `export const TAU = Math.PI * 2;

/** 三维旋转 + 透视投影 */
export function project3d(x, y, z, rotX, rotY, fov = 900) {
  const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
  const x1 = x * cosY - z * sinY;
  const z1 = x * sinY + z * cosY;
  const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
  const y1 = y * cosX - z1 * sinX;
  const z2 = y * sinX + z1 * cosX;
  const depth = fov / (fov + z2);
  return { x: x1 * depth, y: y1 * depth, depth, z: z2 };
}

/** 轨道半径（orbit ∈ [0,1] → 80..440） */
export function orbitRadius(orbit) {
  return 80 + Math.max(0, Math.min(1, orbit)) * 360;
}

/** 开普勒式角速度：内圈快外圈慢（缺陷检测点：半径大速度必须不增） */
export function keplerSpeed(radius) {
  return 0.22 / Math.sqrt(Math.max(60, radius));
}

/** 对象当前轨道角度：初始角（year 归一）+ 公转累计 */
export function orbitAngle(yearNorm, radius, t) {
  return yearNorm * TAU + t * keplerSpeed(radius);
}

/** 时间轴过滤 */
export function visibleByYear(objects, yearCursor) {
  return (objects ?? []).filter((o) => (o.year ?? 0) <= yearCursor);
}

/** 屏幕拾取（阈值内取相机最近） */
export function pickNearest(projected, mx, my, threshold = 30) {
  let best = null;
  for (const p of projected ?? []) {
    const d = Math.hypot(p.sx - mx, p.sy - my);
    if (d <= threshold && (!best || p.camZ < best.camZ)) best = p;
  }
  return best;
}

/** 相机缓动 */
export function easeCamera(t) {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

/** 搜索匹配 */
export function matchesQuery(obj, q) {
  const s = String(q ?? '').trim().toLowerCase();
  if (!s) return false;
  return (obj.name ?? '').toLowerCase().includes(s) || (obj.sub ?? '').toLowerCase().includes(s);
}

/** 年份归一化 */
export function yearNorm(year, min, max) {
  const span = Math.max(1, max - min);
  return Math.max(0, Math.min(1, ((year ?? min) - min) / span));
}

export function yearRange(objects) {
  const ys = (objects ?? []).map((o) => o.year ?? 0);
  if (ys.length === 0) return { min: 2000, max: 2026 };
  return { min: Math.min(...ys), max: Math.max(...ys) };
}

/** 颜色工具 */
export function hexToRgbStr(hex, alpha = 1) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(String(hex ?? ''));
  if (!m) return 'rgba(160,190,220,' + alpha + ')';
  const n = parseInt(m[1], 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
}

/** 确定性伪随机（LCG）：同 seed 返回同序列 */
export function seededRand(seed) {
  let s = Math.floor((Math.abs(Number(seed) || 0) * 9301 + 49297) % 233280) || 7;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

/** 天体分类：驱动程序化纹理（star 恒星 / gas 气巨条纹 / terra 类地大陆 / ice 冰巨 / rock 岩质陨坑） */
export function classifyBody(o) {
  const name = String(o?.name ?? '') + ' ' + String(o?.sub ?? '');
  const size = o?.size ?? 4;
  const m = /^#([0-9a-fA-F]{6})$/.exec(String(o?.color ?? ''));
  const rgb = m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : null;
  const blueish = !!rgb && rgb[2] > rgb[0] + 30 && rgb[2] > 90;
  if ((o?.orbit ?? 0.5) <= 0.02) return 'star';
  if (/太阳|恒星|^star|中心|host|core/i.test(name)) return 'star';
  if (/木星|土星|jupiter|saturn|巨|giant/i.test(name)) return 'gas';
  if (/地球|earth|terra|蓝星/i.test(name)) return 'terra';
  if (/冰|海王|天王|neptune|uranus|ice/i.test(name)) return 'ice';
  if (size >= 7) return 'gas';
  if (blueish && size >= 6) return 'ice';
  if (size >= 5) return 'terra';
  return 'rock';
}

/** 光环判定：LLM ring 字段优先，名称回退（土星等） */
export function hasRing(o) {
  if (typeof o?.ring === 'boolean') return o.ring;
  return /土星|saturn|光环|ring/i.test(String(o?.name ?? '') + ' ' + String(o?.sub ?? ''));
}

/** 气巨条纹带（确定性）：返回 [{t:位置0-1, h:半宽, l:明度调制}] */
export function bandPattern(seed, count = 9) {
  const rnd = seededRand(seed);
  const bands = [];
  let y = 0.02;
  for (let i = 0; i < Math.max(3, Math.min(16, count)); i++) {
    y += 0.05 + rnd() * 0.1;
    if (y > 0.98) break;
    bands.push({ t: y, h: 0.02 + rnd() * 0.045, l: 0.8 + rnd() * 0.4 });
  }
  return bands;
}

/** 恒星星色（色温序列：蓝白→白→黄→橙） */
export function starTint(i) {
  const tints = ['#cfe2ff', '#ffffff', '#fff4e0', '#ffe9c4', '#ffd9a8', '#aac8ff'];
  return tints[Math.abs(Math.floor(i)) % tints.length];
}

/** 银河带密度：屏幕点到对角软带的距离 → 0..1（带上最密） */
export function galaxyDensity(x, y, w, h) {
  const nx = x / Math.max(1, w), ny = y / Math.max(1, h);
  const d = Math.abs(ny - (0.72 - nx * 0.4));
  return Math.max(0, 1 - d * 3.1);
}

/** 轨道拖尾透明度：ahead ∈ [0,TAU)，0=行星处，向后指数衰减（缺陷检测点：单调递减） */
export function trailAlpha(ahead) {
  const a = (((ahead % TAU) + TAU) % TAU);
  return 0.05 + 0.42 * Math.exp(-a / 1.15);
}

/** 自转相位（内圈快）∈ [0,1) */
export function spinPhase(t, radius) {
  return (t * (0.35 / Math.sqrt(Math.max(60, radius)))) % 1;
}

/** 派生档案数据：轨道序 / 相对距离 / 类型标签 */
export function deriveFacts(o, sortedByOrbit) {
  const idx = Math.max(0, (sortedByOrbit ?? []).findIndex((s) => s.name === o.name));
  const kind = classifyBody(o);
  return {
    orbitNo: String(idx + 1).padStart(2, '0'),
    dist: (1 + (o.orbit ?? 0) * 4.4).toFixed(1) + 'x',
    kind: { star: '恒星 · 中心主体', gas: '气态巨行星', terra: '类地行星', ice: '冰巨星', rock: '岩质天体' }[kind] || '天体',
  };
}

/** 年份显示格式化：深时压缩为「X亿年前 / X万」（缺陷检测点：不可返回原始天文数字） */
export function fmtYear(y) {
  const n = Number(y);
  if (!Number.isFinite(n)) return String(y ?? '—');
  const trim = (s) => s.replace(/\\.?0+$/, '');
  if (n <= -1e6) return trim((Math.round(-n / 1e6) / 100).toFixed(2)) + '亿年前';
  if (n >= 1e6) return trim((Math.round(n / 1e6) / 100).toFixed(2)) + '亿年';
  if (n <= -1e4) return Math.round(-n / 1e4) + '万年前';
  if (n >= 1e4) return Math.round(n / 1e4) + '万年';
  return String(Math.round(n));
}
`;

  const test = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project3d, orbitRadius, keplerSpeed, orbitAngle, visibleByYear, pickNearest, easeCamera, matchesQuery, yearRange, yearNorm, hexToRgbStr, seededRand, classifyBody, hasRing, bandPattern, starTint, galaxyDensity, trailAlpha, spinPhase, deriveFacts, fmtYear } from '../logic.mjs';

test('投影：零旋转保坐标', () => {
  const p = project3d(100, 50, 0, 0, 0);
  assert.equal(Math.round(p.x), 100);
});

test('轨道半径线性映射且钳制', () => {
  assert.equal(orbitRadius(0), 80);
  assert.equal(orbitRadius(1), 440);
  assert.equal(orbitRadius(-1), 80);
  assert.equal(orbitRadius(2), 440);
});

test('开普勒速度：外圈不快于内圈（缺陷检测点）', () => {
  for (let r = 80; r < 440; r += 40) {
    assert.ok(keplerSpeed(r + 40) <= keplerSpeed(r) + 1e-9, '半径越大速度必须不增');
  }
});

test('轨道角随时间推进', () => {
  assert.ok(orbitAngle(0.5, 200, 100) > orbitAngle(0.5, 200, 0));
});

test('时间轴过滤含等号', () => {
  const objs = [{ year: 1962 }, { year: 1984 }, { year: 2026 }];
  assert.equal(visibleByYear(objs, 1984).length, 2);
  assert.equal(visibleByYear(objs, 2026).length, 3);
});

test('拾取取相机最近', () => {
  const ps = [
    { sx: 50, sy: 50, camZ: 100, name: 'far' },
    { sx: 55, sy: 55, camZ: -50, name: 'near' },
    { sx: 400, sy: 400, camZ: 0, name: 'out' },
  ];
  assert.equal(pickNearest(ps, 52, 52)?.name, 'near');
  assert.equal(pickNearest(ps, 300, 300), null);
});

test('缓动端点精确（缺陷检测点）', () => {
  assert.equal(easeCamera(0), 0);
  assert.equal(easeCamera(1), 1);
  assert.equal(easeCamera(-1), 0);
  assert.equal(easeCamera(2), 1);
});

test('搜索与年份工具', () => {
  assert.equal(matchesQuery({ name: '250 GTO', sub: '1962' }, 'gto'), true);
  assert.equal(matchesQuery({ name: 'x' }, ''), false);
  assert.deepEqual(yearRange([{ year: 1947 }, { year: 2024 }]), { min: 1947, max: 2024 });
  assert.equal(yearNorm(1947, 1947, 2024), 0);
  assert.equal(yearNorm(2024, 1947, 2024), 1);
});

test('颜色工具', () => {
  assert.equal(hexToRgbStr('#ff8000', 1), 'rgba(255,128,0,1)');
  assert.ok(hexToRgbStr('bad').startsWith('rgba('));
});

test('伪随机确定性（缺陷检测点：同 seed 同序列）', () => {
  const a = seededRand(7), b = seededRand(7);
  const seq1 = [a(), a(), a()], seq2 = [b(), b(), b()];
  assert.deepEqual(seq1, seq2);
  assert.ok(seq1[0] >= 0 && seq1[0] < 1);
});

test('天体分类', () => {
  assert.equal(classifyBody({ name: '太阳', orbit: 0, size: 11, color: '#ffd166' }), 'star');
  assert.equal(classifyBody({ name: '木星', orbit: 0.6, size: 10, color: '#c9a06e' }), 'gas');
  assert.equal(classifyBody({ name: '地球', orbit: 0.3, size: 5, color: '#3f7fd4' }), 'terra');
  assert.equal(classifyBody({ name: '海王星', orbit: 0.95, size: 8, color: '#3e66f4' }), 'ice');
  assert.equal(classifyBody({ name: '柯伊伯碎石', orbit: 0.9, size: 3, color: '#9a8f80' }), 'rock');
  assert.equal(classifyBody({ name: '某某', orbit: 0.5, size: 8, color: '#c08050' }), 'gas');
});

test('光环判定：LLM 字段优先 + 名称回退', () => {
  assert.equal(hasRing({ name: 'X', ring: true }), true);
  assert.equal(hasRing({ name: '土星' }), true);
  assert.equal(hasRing({ name: 'Saturn' }), true);
  assert.equal(hasRing({ name: '火星', ring: false }), false);
});

test('条纹带确定性与取值范围', () => {
  assert.deepEqual(bandPattern(11, 8), bandPattern(11, 8));
  const bands = bandPattern(3, 12);
  assert.ok(bands.length >= 3 && bands.length <= 12);
  for (const b of bands) assert.ok(b.t > 0 && b.t <= 1 && b.l > 0);
});

test('星色循环', () => {
  assert.equal(starTint(0), starTint(6));
  assert.equal(starTint(2), starTint(8));
});

test('银河带密度：带上高于带外', () => {
  const onBand = galaxyDensity(200, 0.72 * 600 - 0.4 * (200 / 1000) * 600, 1000, 600);
  const offBand = galaxyDensity(200, 60, 1000, 600);
  assert.ok(onBand > offBand);
});

test('拖尾透明度单调递减（缺陷检测点）', () => {
  assert.ok(trailAlpha(0) > 0.42);
  assert.ok(trailAlpha(0.1) > trailAlpha(0.5));
  assert.ok(trailAlpha(1) > trailAlpha(2) && trailAlpha(2) > trailAlpha(3));
  assert.ok(trailAlpha(3) >= 0.05);
});

test('自转相位有界', () => {
  for (const t of [0, 5, 100.7]) {
    const p = spinPhase(t, 200);
    assert.ok(p >= 0 && p < 1);
  }
  assert.equal(spinPhase(100, 200), spinPhase(100, 200));
});

test('档案派生数据', () => {
  const sorted = [{ name: 'A', orbit: 0 }, { name: 'B', orbit: 0.5 }, { name: 'C', orbit: 0.9 }];
  const f = deriveFacts({ name: 'B', orbit: 0.5, size: 5, color: '#3f7fd4' }, sorted);
  assert.equal(f.orbitNo, '02');
  assert.equal(f.kind, '类地行星');
  assert.ok(f.dist === '3.2x');
});

test('年份格式化：深时压缩（缺陷检测点：不返回原始天文数字）', () => {
  assert.equal(fmtYear(-4600000000), '46亿年前');
  assert.equal(fmtYear(4550000000), '45.5亿年');
  assert.equal(fmtYear(-50000), '5万年前');
  assert.equal(fmtYear(1969), '1969');
  assert.ok(!fmtYear(-4500000000).match(/000000/));
});
`;

  const app = `import { project3d, orbitRadius, orbitAngle, visibleByYear, pickNearest, easeCamera, matchesQuery, yearRange, yearNorm, hexToRgbStr, classifyBody, hasRing, bandPattern, starTint, galaxyDensity, trailAlpha, spinPhase, deriveFacts, seededRand, fmtYear, TAU } from './logic.mjs';
import { ATLAS } from './data.js';

const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
const info = document.getElementById('info');
const chips = document.getElementById('chips');
const timeline = document.getElementById('timeline');
const yearEl = document.getElementById('year');
const searchEl = document.getElementById('search');
const hud = document.getElementById('hud');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const GOLD = [212, 183, 132];
const INK = 'rgba(231,225,213,';
const MONO = '"IBM Plex Mono","Cascadia Mono",ui-monospace,monospace';
const SANS = '"Inter","Segoe UI","Microsoft YaHei",sans-serif';
const rgba = (c, m, a = 1) => 'rgba(' + Math.min(255, Math.round(c[0] * m)) + ',' + Math.min(255, Math.round(c[1] * m)) + ',' + Math.min(255, Math.round(c[2] * m)) + ',' + a + ')';
const parseHex = (hex) => {
  const m = /^#([0-9a-fA-F]{6})$/.exec(String(hex ?? ''));
  if (!m) return [159, 195, 232];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

let W = 0, H = 0, dpr = Math.min(devicePixelRatio || 1, 2);
function resize() {
  W = innerWidth; H = innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resize();
addEventListener('resize', resize);

/* ---------------- 数据与纹理 ---------------- */
const RANGE = yearRange(ATLAS.objects);
const span = Math.max(1, RANGE.max - RANGE.min);
const OBJ = ATLAS.objects.map((o, i) => ({
  ...o,
  idx: i,
  R: orbitRadius(o.orbit ?? 0.5),
  n0: yearNorm(o.year, RANGE.min, RANGE.max),
  rgb: parseHex(o.color),
  kind: classifyBody(o),
  ring: hasRing(o),
  tex: null,
  camZ: 0, sx: 0, sy: 0, depth: 1, vis: false,
}));
const SORTED = [...OBJ].sort((a, b) => (a.orbit ?? 0) - (b.orbit ?? 0));
const center = OBJ.reduce((a, b) => ((a.orbit ?? 1) <= (b.orbit ?? 1) ? a : b), OBJ[0]);

/** 程序化行星纹理（160x160，绘制时横向滚动包裹模拟自转） */
function makeTexture(o) {
  const S = 160;
  const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
  const g = cv.getContext('2d');
  const rnd = seededRand(o.idx * 7.13 + (o.size ?? 4) + (o.R ?? 0));
  const base = o.rgb;
  const fill = (m, a) => { g.fillStyle = rgba(base, m, a === undefined ? 1 : a); };
  const wavyBand = (y0, hh, mul, alpha) => {
    g.globalAlpha = alpha;
    g.fillStyle = rgba(base, mul);
    g.beginPath();
    for (let x = 0; x <= S; x += 10) { const wob = Math.sin(x / 21 + y0 * 9 + o.idx) * 2.4; if (x === 0) g.moveTo(x, y0 + wob); else g.lineTo(x, y0 + wob); }
    for (let x = S; x >= 0; x -= 10) { const wob = Math.sin(x / 21 + y0 * 9 + o.idx) * 2.4; g.lineTo(x, y0 + wob + hh); }
    g.closePath(); g.fill();
    g.globalAlpha = 1;
  };
  if (o.kind === 'gas') {
    fill(1); g.fillRect(0, 0, S, S);
    for (const b of bandPattern(o.idx + 3, 8 + Math.floor(rnd() * 5))) wavyBand(b.t * S, Math.max(3, b.h * S * 2.2), b.l, 0.6);
    // 大风暴斑
    g.globalAlpha = 0.5; g.fillStyle = rgba(base, 1.45);
    g.beginPath(); g.ellipse(rnd() * S, S * (0.52 + rnd() * 0.22), 11, 4.6, 0, 0, TAU); g.fill();
    g.globalAlpha = 0.35; g.fillStyle = rgba(base, 0.6);
    g.beginPath(); g.ellipse(rnd() * S, S * (0.25 + rnd() * 0.2), 7, 3, 0, 0, TAU); g.fill();
    g.globalAlpha = 1;
  } else if (o.kind === 'terra') {
    // 海洋底 + 大陆斑块 + 极冠
    const ocean = mix(base, [24, 52, 96], 0.35);
    g.fillStyle = rgba(ocean, 1); g.fillRect(0, 0, S, S);
    const land = mix(base, [96, 118, 66], 0.62);
    for (let i = 0; i < 10; i++) {
      g.fillStyle = rgba(land, 0.55 + rnd() * 0.4);
      const cx = rnd() * S, cy = S * (0.18 + rnd() * 0.64), r = 6 + rnd() * 16;
      g.beginPath();
      for (let k = 0; k < 7; k++) { const a = (k / 7) * TAU; const rr = r * (0.6 + rnd() * 0.6); g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.7); }
      g.closePath(); g.fill();
    }
    g.fillStyle = 'rgba(240,244,248,0.85)';
    g.fillRect(0, 0, S, 7); g.fillRect(0, S - 7, S, 7);
  } else if (o.kind === 'ice') {
    const gr = g.createLinearGradient(0, 0, 0, S);
    gr.addColorStop(0, rgba(mix(base, [255, 255, 255], 0.5), 1));
    gr.addColorStop(0.5, rgba(base, 1));
    gr.addColorStop(1, rgba(mix(base, [20, 30, 60], 0.35), 1));
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    for (const b of bandPattern(o.idx + 9, 4)) wavyBand(b.t * S, 5, b.l * 0.95, 0.22);
  } else if (o.kind === 'rock') {
    fill(1); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = rnd() > 0.5 ? rgba(base, 1.3) : rgba(base, 0.72);
      g.globalAlpha = 0.16;
      g.fillRect(rnd() * S, rnd() * S, 1.6, 1.6);
    }
    g.globalAlpha = 1;
    for (let i = 0; i < 8; i++) {
      const cx = rnd() * S, cy = rnd() * S, r = 3 + rnd() * 7;
      g.fillStyle = rgba(base, 0.55); g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
      g.strokeStyle = rgba(base, 1.5); g.globalAlpha = 0.5;
      g.beginPath(); g.arc(cx, cy, r, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      g.globalAlpha = 1;
    }
  } else { // star：米粒组织
    const hot = mix(base, [255, 214, 130], 0.5);
    g.fillStyle = rgba(hot, 1); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 420; i++) {
      g.fillStyle = rnd() > 0.45 ? rgba(base, 1.35) : rgba(mix(base, [120, 60, 20], 0.5), 1);
      g.globalAlpha = 0.2;
      const r = 1.4 + rnd() * 3.4;
      g.beginPath(); g.arc(rnd() * S, rnd() * S, r, 0, TAU); g.fill();
    }
    g.globalAlpha = 1;
  }
  // 云层（类地独立一层，滚动速度不同）
  let clouds = null;
  if (o.kind === 'terra') {
    clouds = document.createElement('canvas'); clouds.width = S; clouds.height = S;
    const c2 = clouds.getContext('2d');
    const crnd = seededRand(o.idx * 31 + 5);
    for (let i = 0; i < 16; i++) {
      c2.fillStyle = 'rgba(248,250,252,' + (0.28 + crnd() * 0.34) + ')';
      const cx = crnd() * S, cy = crnd() * S, w = 14 + crnd() * 34, h = 3 + crnd() * 7;
      c2.beginPath(); c2.ellipse(cx, cy, w, h, 0, 0, TAU); c2.fill();
      c2.beginPath(); c2.ellipse((cx + S / 2) % S, (cy + 12) % S, w * 0.7, h * 0.8, 0, 0, TAU); c2.fill();
    }
  }
  return { surf: cv, clouds };
}
for (const o of OBJ) o.tex = makeTexture(o);

/* ---------------- 星域（离屏预渲染 ×3 层视差） ---------------- */
const SF_W = 1600, SF_H = 1000;
function makeStarLayer(density, sizeMul, nebula) {
  const cv = document.createElement('canvas'); cv.width = SF_W; cv.height = SF_H;
  const g = cv.getContext('2d');
  const rnd = seededRand(density * 991 + sizeMul * 37);
  if (nebula) {
    for (let i = 0; i < 4; i++) {
      const nx = rnd() * SF_W, ny = SF_H * (0.4 + rnd() * 0.5), nr = 160 + rnd() * 240;
      const hue = rnd() > 0.5 ? [122, 108, 158] : [148, 118, 96];
      const gr = g.createRadialGradient(nx, ny, 0, nx, ny, nr);
      gr.addColorStop(0, rgba(hue, 1, 0.055)); gr.addColorStop(1, rgba(hue, 1, 0));
      g.fillStyle = gr; g.beginPath(); g.arc(nx, ny, nr, 0, TAU); g.fill();
    }
  }
  const n = Math.round(360 * density);
  for (let i = 0; i < n; i++) {
    const x = rnd() * SF_W, y = rnd() * SF_H;
    const dens = galaxyDensity(x, y, SF_W, SF_H);
    if (rnd() > 0.36 + dens * 0.64) continue; // 银河带拒收采样
    g.fillStyle = starTint(Math.floor(rnd() * 6));
    g.globalAlpha = 0.22 + rnd() * 0.6 * (0.5 + dens * 0.5);
    const r = (0.35 + rnd() * 0.85) * sizeMul;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    if (i % 89 === 0) { // 少量亮星 + 十字衍射
      g.globalAlpha = 0.75;
      g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 0.7;
      g.beginPath(); g.moveTo(x - 5, y); g.lineTo(x + 5, y); g.moveTo(x, y - 5); g.lineTo(x, y + 5); g.stroke();
    }
  }
  g.globalAlpha = 1;
  return cv;
}
const starLayers = [
  { cv: makeStarLayer(1, 0.55, true), par: 26 },
  { cv: makeStarLayer(0.6, 0.8, true), par: 52 },
  { cv: makeStarLayer(0.34, 1.15, false), par: 92 },
];
const twinkles = Array.from({ length: 46 }, (_, i) => {
  const rnd = seededRand(i * 17 + 3);
  return { x: rnd() * 1, y: rnd() * 1, ph: rnd() * TAU, sp: 0.7 + rnd() * 1.6 };
});

/* ---------------- 相机与交互 ---------------- */
let yearCursor = RANGE.max;
let rotX = reduced ? 0.42 : 1.06, rotY = 0;
let zoom = reduced ? 1 : 0.55;
let targetRotX = 0.42, targetRotY = 0, targetZoom = 1;
let hover = null, focus = null;
let flyT = 1, flyFrom = null, flyTo = null;
let query = '';
let simT = 0;
let infoCache = '';
let lastInteract = performance.now();

let dragging = false, lastX = 0, lastY = 0, moved = 0;
canvas.addEventListener('mousedown', (e) => { dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; lastInteract = performance.now(); canvas.style.cursor = 'grabbing'; });
addEventListener('mousemove', (e) => {
  if (dragging) {
    targetRotY += (e.clientX - lastX) * 0.005;
    targetRotX = Math.max(-1.4, Math.min(1.4, targetRotX + (e.clientY - lastY) * 0.005));
    moved += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY);
    lastX = e.clientX; lastY = e.clientY; lastInteract = performance.now();
  }
  const hit = pickNearest(OBJ.filter((o) => o.vis).map((o) => ({ name: o.name, sx: o.sx, sy: o.sy, camZ: o.camZ })), e.clientX, e.clientY, 30);
  hover = hit ? (OBJ.find((o) => o.name === hit.name) || null) : null;
  if (!dragging) canvas.style.cursor = hover ? 'pointer' : 'grab';
});
addEventListener('mouseup', () => { dragging = false; canvas.style.cursor = hover ? 'pointer' : 'grab'; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  targetZoom = Math.max(0.3, Math.min(4.5, targetZoom * (e.deltaY < 0 ? 1.12 : 0.89)));
  lastInteract = performance.now();
}, { passive: false });

/* 触屏：单指旋转 / 双指缩放 / 轻点聚焦 */
let pinchDist = 0;
canvas.addEventListener('touchstart', (e) => {
  lastInteract = performance.now();
  if (e.touches.length === 1) { dragging = true; moved = 0; lastX = e.touches[0].clientX; lastY = e.touches[0].clientY; }
  else if (e.touches.length === 2) { dragging = false; pinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }
}, { passive: true });
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault(); lastInteract = performance.now();
  if (e.touches.length === 1 && dragging) {
    targetRotY += (e.touches[0].clientX - lastX) * 0.006;
    targetRotX = Math.max(-1.4, Math.min(1.4, targetRotX + (e.touches[0].clientY - lastY) * 0.006));
    moved += Math.abs(e.touches[0].clientX - lastX) + Math.abs(e.touches[0].clientY - lastY);
    lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
  } else if (e.touches.length === 2) {
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    if (pinchDist > 0) targetZoom = Math.max(0.3, Math.min(4.5, targetZoom * (d / pinchDist)));
    pinchDist = d;
  }
}, { passive: false });
canvas.addEventListener('touchend', (e) => {
  if (e.touches.length === 0 && moved < 8 && dragging) {
    const hit = pickNearest(OBJ.filter((o) => o.vis).map((o) => ({ name: o.name, sx: o.sx, sy: o.sy, camZ: o.camZ })), lastX, lastY, 34);
    if (hit) focusOn(OBJ.find((o) => o.name === hit.name));
  }
  dragging = false; pinchDist = 0;
});

const focusOn = (o) => {
  focus = o;
  flyFrom = { rotX, rotY, zoom };
  flyTo = { rotX: 0.18, rotY: -Math.PI / 2 - orbitAngle(o.n0, o.R, simT + 1.4), zoom: Math.max(1.5, 2.7 - (o.size ?? 4) * 0.12) };
  flyT = 0;
  renderInfo(o);
  renderChips();
};
canvas.addEventListener('click', () => {
  if (moved > 6) return;
  if (hover) focusOn(hover);
});

/* ---------------- 档案信息卡 ---------------- */
function factsRows(o) {
  const f = deriveFacts(o, SORTED);
  let rows = '<div><dt>收录</dt><dd>' + fmtYear(o.year) + '</dd></div>';
  if (o.metric !== undefined && o.metric !== null && o.metricLabel) rows += '<div><dt>' + String(o.metricLabel).slice(0, 8) + '</dt><dd>' + o.metric + '</dd></div>';
  rows += '<div><dt>轨道</dt><dd>NO.' + f.orbitNo + ' · ' + f.dist + '</dd></div>';
  rows += '<div><dt>类型</dt><dd>' + f.kind + '</dd></div>';
  if (o.ring) rows += '<div><dt>特征</dt><dd>行星环</dd></div>';
  return rows;
}
function renderInfo(o) {
  const key = o ? o.name : '__overview__' + yearCursor + (hover ? hover.name : '');
  if (key === infoCache) return;
  infoCache = key;
  if (!o) {
    const vis = visibleByYear(ATLAS.objects, yearCursor).length;
    info.innerHTML = '<div class="a-kick">' + esc(ATLAS.theme) + ' · ATLAS</div><h2>' + esc(ATLAS.theme) + '</h2><i class="a-rule"></i>' +
      '<p class="a-desc">已收录 <b>' + vis + '</b> / ' + ATLAS.objects.length + ' 个对象（' + ATLAS.unitLabel + ' ' + fmtYear(RANGE.min) + ' – ' + fmtYear(RANGE.max) + '）。拖动旋转视角 · 滚轮缩放 · 点击对象查看档案 · 底部时间轴回放。</p>' +
      '<div class="a-src">' + esc((ATLAS.meta && ATLAS.meta.via) || '') + '</div>';
    return;
  }
  const f = deriveFacts(o, SORTED);
  info.innerHTML = '<div class="a-kick">' + esc(ATLAS.theme) + ' · NO.' + f.orbitNo + '</div><h2>' + esc(o.name) + '</h2>' +
    (o.sub ? '<div class="a-sub">' + esc(o.sub) + '</div>' : '') + '<i class="a-rule"></i>' +
    '<p class="a-desc">' + esc(o.desc || '') + '</p>' +
    '<dl class="a-facts">' + factsRows(o) + '</dl>' +
    '<div class="a-src">' + esc((ATLAS.meta && ATLAS.meta.via) || '') + '</div>' +
    (focus && focus.name === o.name ? '<button id="i-back">← 返回全景</button>' : '');
  const back = document.getElementById('i-back');
  if (back) back.onclick = () => { focus = null; flyFrom = { rotX, rotY, zoom }; flyTo = { rotX: 0.42, rotY: rotY, zoom: 1 }; flyT = 0; infoCache = ''; renderInfo(null); renderChips(); };
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function renderChips() {
  chips.innerHTML = '';
  for (const o of OBJ) {
    const c = document.createElement('span');
    c.className = 'chip2' + (focus && focus.name === o.name ? ' on' : '') + (o.vis ? '' : ' off');
    c.textContent = o.name;
    if (o.color) c.style.setProperty('--c', o.color);
    c.onclick = () => { lastInteract = performance.now(); yearCursor = Math.max(yearCursor, o.year ?? RANGE.min); drawTimeline(); renderChips(); focusOn(o); };
    chips.appendChild(c);
  }
}

const drawTimeline = () => {
  const pct = (yearCursor - RANGE.min) / span;
  timeline.querySelector('.tl-fill').style.width = (pct * 100) + '%';
  timeline.querySelector('.tl-dot').style.left = (pct * 100) + '%';
  yearEl.textContent = fmtYear(yearCursor);
  hud.innerHTML = esc(ATLAS.theme) + ' · <b>' + visibleByYear(ATLAS.objects, yearCursor).length + '</b> / ' + ATLAS.objects.length + ' 已收录';
};
let tlDrag = false;
const setFromEvent = (e) => {
  const r = timeline.getBoundingClientRect();
  yearCursor = RANGE.min + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * span;
  lastInteract = performance.now();
  drawTimeline(); renderChips();
};
timeline.addEventListener('mousedown', (e) => { tlDrag = true; setFromEvent(e); });
addEventListener('mousemove', (e) => { if (tlDrag) setFromEvent(e); });
addEventListener('mouseup', () => { tlDrag = false; });
searchEl.addEventListener('input', () => { query = searchEl.value; });

/* ---------------- 渲染 ---------------- */
function drawRingPass(o, x, y, r, back) {
  const rx = r * 2.15;
  const sq = Math.max(0.14, Math.abs(Math.sin(rotX)));
  const bands = [
    { ir: 1.32, or: 1.52, a: 0.3, m: 1.16 },
    { ir: 1.56, or: 1.86, a: 0.52, m: 1.0 },
    { ir: 1.9, or: 2.14, a: 0.32, m: 0.86 },
  ];
  ctx.save();
  ctx.beginPath();
  const top = back ? (rotX >= 0) : (rotX < 0);
  const hh = rx + 8;
  ctx.rect(x - hh, top ? y - hh : y, hh * 2, hh);
  ctx.clip();
  for (const b of bands) {
    const mid = r * (b.ir + b.or) / 2;
    ctx.beginPath();
    ctx.ellipse(x, y, mid, mid * sq, 0, 0, TAU);
    ctx.strokeStyle = rgba(o.rgb, b.m, b.a);
    ctx.lineWidth = r * (b.or - b.ir) / 2.05;
    ctx.stroke();
  }
  ctx.restore();
}

function drawBody(o, x, y, r, t) {
  const isStar = o.kind === 'star' || o === center;
  const pulse = reduced ? 1 : 1 + (isStar ? 0.014 * Math.sin(t / 620) : 0);
  const R = r * pulse;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  if (isStar) {
    const layers = [[3.3, 0.06], [2.15, 0.11], [1.4, 0.18]];
    for (const [m, a] of layers) {
      const g = ctx.createRadialGradient(x, y, R * 0.7, x, y, R * m);
      g.addColorStop(0, rgba(o.rgb, 1.18, a)); g.addColorStop(1, rgba(o.rgb, 1, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R * m, 0, TAU); ctx.fill();
    }
    if (!reduced) {
      ctx.strokeStyle = rgba(o.rgb, 1.25, 0.07); ctx.lineWidth = 1.4; ctx.lineCap = 'round';
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU + t / 21000;
        const len = R * (1.8 + 0.55 * Math.sin(t / 640 + i * 2.1));
        ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * R * 1.02, y + Math.sin(a) * R * 1.02);
        ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke();
      }
    }
  } else {
    const g = ctx.createRadialGradient(x, y, R * 0.85, x, y, R * 2.15);
    g.addColorStop(0, rgba(o.rgb, 1, o.kind === 'terra' ? 0.2 : 0.13)); g.addColorStop(1, rgba(o.rgb, 1, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R * 2.15, 0, TAU); ctx.fill();
  }
  ctx.restore();

  // 球体：纹理横向滚动（自转）+ 球面明暗 + 终结者
  if (o.ring) drawRingPass(o, x, y, R, true);
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.clip();
  const tw = R * 2;
  const off = (spinPhase(t * (reduced ? 0.4 : 1), o.R) * tw) % tw;
  ctx.drawImage(o.tex.surf, x - R + off - tw, y - R, tw, tw);
  ctx.drawImage(o.tex.surf, x - R + off, y - R, tw, tw);
  if (o.tex.clouds) {
    const off2 = (spinPhase(t * 1.7 + 0.31, o.R) * tw) % tw;
    ctx.globalAlpha = 0.85;
    ctx.drawImage(o.tex.clouds, x - R + off2 - tw, y - R, tw, tw);
    ctx.drawImage(o.tex.clouds, x - R + off2, y - R, tw, tw);
    ctx.globalAlpha = 1;
  }
  const lightAng = isStar ? -2.2 : Math.atan2(cy0 - y, cx0 - x); // 光源指向中心主体
  const lx = x + Math.cos(lightAng) * R * 0.5, ly = y + Math.sin(lightAng) * R * 0.5;
  const sh = ctx.createRadialGradient(lx, ly, R * 0.08, x, y, R * 1.02);
  if (isStar) {
    sh.addColorStop(0, 'rgba(255,252,240,0.28)');
    sh.addColorStop(0.7, 'rgba(255,240,200,0)');
    sh.addColorStop(1, 'rgba(120,60,10,0.35)');
  } else {
    sh.addColorStop(0, 'rgba(255,250,235,0.16)');
    sh.addColorStop(0.55, 'rgba(0,0,0,0)');
    sh.addColorStop(0.82, 'rgba(3,3,5,0.58)');
    sh.addColorStop(1, 'rgba(2,2,3,0.9)');
  }
  ctx.fillStyle = sh; ctx.fillRect(x - R, y - R, tw, tw);
  ctx.restore();
  ctx.strokeStyle = rgba(o.rgb, 1.25, 0.32);
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(x, y, R - 0.5, 0, TAU); ctx.stroke();
  if (o.ring) drawRingPass(o, x, y, R, false);
}

function drawOrbitTrail(o, scale, base, alphaMul) {
  const segs = 72;
  const pAng = orbitAngle(o.n0, o.R, simT);
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const ang = (i / segs) * TAU;
    const p = project3d(Math.cos(ang) * o.R, 0, Math.sin(ang) * o.R, rotX, rotY);
    pts.push([cx0 + p.x * scale, cy0 + p.y * scale]);
  }
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * TAU;
    const ahead = (pAng - a0 + TAU) % TAU;
    ctx.strokeStyle = 'rgba(' + base + ',' + (trailAlpha(ahead) * alphaMul).toFixed(3) + ')';
    ctx.beginPath(); ctx.moveTo(pts[i][0], pts[i][1]); ctx.lineTo(pts[i + 1][0], pts[i + 1][1]); ctx.stroke();
  }
}

function drawLabel(o, x, y, r, strong) {
  const f = deriveFacts(o, SORTED);
  const alpha = strong ? 1 : Math.min(0.85, (o.depth - 0.55) * 2.2);
  if (alpha <= 0.08) return;
  const lx = x + r * 0.72 + 8, ly = y - r * 0.72 - 8;
  ctx.strokeStyle = 'rgba(212,183,132,' + (0.38 * alpha).toFixed(2) + ')';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + r * 0.62, y - r * 0.62); ctx.lineTo(lx, ly); ctx.lineTo(lx + 14, ly); ctx.stroke();
  if ('letterSpacing' in ctx) ctx.letterSpacing = '1.5px';
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = '8.5px ' + MONO;
  ctx.fillStyle = 'rgba(212,183,132,' + (0.85 * alpha).toFixed(2) + ')';
  ctx.fillText('NO.' + f.orbitNo, lx + 3, ly - 13);
  ctx.font = (strong ? '12.5px ' : '11px ') + SANS;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0.5px';
  ctx.fillStyle = INK + (0.92 * alpha).toFixed(2) + ')';
  ctx.fillText(o.name, lx + 3, ly - 1);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}

let cx0 = 0, cy0 = 0;
function frame(t) {
  if (flyT < 1 && flyFrom && flyTo) {
    const e = easeCamera(flyT);
    rotX = flyFrom.rotX + (flyTo.rotX - flyFrom.rotX) * e;
    rotY = flyFrom.rotY + (flyTo.rotY - flyFrom.rotY) * e;
    zoom = flyFrom.zoom + (flyTo.zoom - flyFrom.zoom) * e;
    flyT += reduced ? 0.05 : 0.02;
    targetRotX = rotX; targetRotY = rotY; targetZoom = zoom;
  } else {
    // 聚焦跟踪：空闲后相机持续对准目标行星（公转不脱靶；拖拽后 2.5s 内不接管）
    if (focus && flyT >= 1 && performance.now() - lastInteract > 2500) {
      targetRotY = -Math.PI / 2 - orbitAngle(focus.n0, focus.R, simT);
      targetRotX += (0.18 - targetRotX) * 0.02;
    }
    rotX += (targetRotX - rotX) * 0.07;
    rotY += (targetRotY - rotY) * 0.07;
    zoom += (targetZoom - zoom) * 0.09;
    if (!focus && !reduced && performance.now() - lastInteract > 6000) targetRotY += 0.00035; // 闲置巡航
  }

  simT += reduced ? 0.007 : 0.016;

  // 背景：暖黑纵向渐变
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#050505'); bg.addColorStop(0.72, '#070708'); bg.addColorStop(1, '#0b0b0a');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // 星域三层视差
  for (const L of starLayers) {
    const ox = ((-rotY * L.par) % SF_W + SF_W) % SF_W;
    const oy = Math.max(-60, Math.min(60, (0.42 - rotX) * L.par * 0.5));
    ctx.globalAlpha = 0.9;
    ctx.drawImage(L.cv, -ox, oy, SF_W, SF_H);
    ctx.drawImage(L.cv, -ox + SF_W, oy, SF_W, SF_H);
    ctx.globalAlpha = 1;
  }
  // 闪烁星
  if (!reduced) {
    for (const s of twinkles) {
      const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t / 800 * s.sp + s.ph));
      ctx.fillStyle = 'rgba(255,248,235,' + a.toFixed(2) + ')';
      ctx.fillRect(s.x * W, s.y * H, 1.3, 1.3);
    }
  }

  const scale = Math.min(W, H) / 900 * zoom;
  cx0 = W / 2; cy0 = H / 2;
  const visible = visibleByYear(ATLAS.objects, yearCursor);
  const visNames = new Set(visible.map((o) => o.name));

  for (const o of OBJ) {
    if (o.R <= 120) continue;
    const isHot = (hover && hover.name === o.name) || (focus && focus.name === o.name);
    drawOrbitTrail(o, scale, isHot ? '212,183,132' : '150,168,196', visNames.has(o.name) ? (isHot ? 1.5 : 0.75) : 0.28);
  }

  const drawList = OBJ.map((o) => {
    const ang = orbitAngle(o.n0, o.R, simT);
    const wx = Math.cos(ang) * o.R, wz = Math.sin(ang) * o.R;
    const p = project3d(wx, 0, wz, rotX, rotY);
    o.sx = cx0 + p.x * scale; o.sy = cy0 + p.y * scale; o.camZ = p.z; o.depth = p.depth;
    return o;
  }).sort((a, b) => b.camZ - a.camZ);

  for (const o of drawList) {
    o.vis = visNames.has(o.name);
    const isHover = hover && hover.name === o.name;
    const isFocus = focus && focus.name === o.name;
    const isMatch = query && matchesQuery(o, query);
    const isCenter = o === center;
    if (!o.vis) {
      ctx.fillStyle = 'rgba(150,165,190,0.15)';
      ctx.beginPath(); ctx.arc(o.sx, o.sy, 1.4, 0, TAU); ctx.fill();
      continue;
    }
    const baseR = Math.max(1.6, (isCenter ? 26 : o.size ?? 4) * (0.55 + o.depth * 0.75) * Math.max(0.6, Math.min(1.9, zoom * 0.9)) * (isHover && !isFocus ? 1.1 : 1));
    drawBody(o, o.sx, o.sy, baseR, t);
    if (isFocus || isMatch) {
      ctx.strokeStyle = isMatch ? 'rgba(255,220,120,0.9)' : 'rgba(212,183,132,0.85)';
      ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.arc(o.sx, o.sy, baseR * (o.ring ? 2.3 : 1) + 7 + (reduced ? 0 : Math.sin(t / 240) * 2), 0, TAU); ctx.stroke();
    }
    if (baseR >= 2.4 || isHover || isFocus || isMatch) drawLabel(o, o.sx, o.sy, baseR * (o.ring ? 2.15 : 1), isHover || isFocus || isMatch);
    if (isHover && !focus) renderInfo(o);
  }
  if (!hover && !focus) renderInfo(null);
  requestAnimationFrame(frame);
}

drawTimeline();
renderInfo(null);
renderChips();
document.getElementById('tl-min').textContent = fmtYear(RANGE.min);
document.getElementById('tl-max').textContent = fmtYear(RANGE.max);
requestAnimationFrame(frame);
`;

  const html = pageShell(
    spec.title,
    spec.subtitle,
    `<div id="hud" class="hud"></div>
<input id="search" class="search" placeholder="SEARCH…" autocomplete="off" />
<canvas id="scene"></canvas>
<div id="info" class="info"></div>
<div class="tl-wrap">
  <div id="chips" class="chips"></div>
  <div id="timeline" class="timeline"><div class="tl-track"></div><div class="tl-fill"></div><div class="tl-dot"></div></div>
  <div class="tl-meta"><span id="tl-min"></span><b id="year"></b><span id="tl-max"></span></div>
</div>`,
    `<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@300;400;600&display=swap" rel="stylesheet" />`,
  );

  const css = buildThemeCss(getStyleDef(spec)) + `
* { margin: 0; box-sizing: border-box; }
body { display: block; padding: 0; overflow: hidden; background: #050505; }
.app > header, .app > footer { display: none; }
#scene { position: fixed; inset: 0; display: block; cursor: grab; touch-action: none; }
:root { --gold: #d4b784; --ink: #e7e1d5; --ink-dim: #b9b2a4; --ink-faint: #7e7a72; --line: #34342f; --mono: "IBM Plex Mono","Cascadia Mono",ui-monospace,monospace; --sans: "Inter","Segoe UI","Microsoft YaHei",sans-serif; }
.hud { position: fixed; top: 20px; left: 22px; color: var(--ink-dim); font: 400 11px/1.5 var(--mono); letter-spacing: 2px; z-index: 5; pointer-events: none; text-transform: uppercase; }
.hud b { color: var(--gold); font-weight: 500; }
.search { position: fixed; top: 16px; right: 20px; width: 200px; background: rgba(11,11,10,.72); border: 1px solid rgba(212,183,132,.22); color: var(--ink); border-radius: 2px; padding: 9px 14px; font: 400 11px var(--mono); letter-spacing: 2px; z-index: 6; backdrop-filter: blur(10px); }
.search::placeholder { color: var(--ink-faint); letter-spacing: 2px; }
.search:focus { outline: none; border-color: rgba(212,183,132,.55); }
.info { position: fixed; top: 76px; left: 22px; width: 316px; max-height: calc(100vh - 210px); overflow-y: auto; background: linear-gradient(180deg, rgba(11,11,10,.88), rgba(8,8,7,.82)); border: 1px solid rgba(212,183,132,.18); border-top: 1px solid rgba(212,183,132,.45); border-radius: 3px; padding: 20px 22px 18px; z-index: 6; backdrop-filter: blur(14px); scrollbar-width: thin; }
.a-kick { color: var(--gold); font: 500 9.5px var(--mono); letter-spacing: 3px; margin-bottom: 10px; text-transform: uppercase; opacity: .9; }
.info h2 { color: var(--ink); font: 300 24px/1.2 var(--sans); letter-spacing: .5px; margin-bottom: 5px; }
.a-sub { color: var(--ink-dim); font: 400 10px var(--mono); letter-spacing: 1.8px; margin-bottom: 12px; text-transform: uppercase; }
.a-rule { display: block; height: 1px; background: linear-gradient(90deg, rgba(212,183,132,.65), rgba(212,183,132,.06)); margin: 0 0 12px; }
.a-desc { color: var(--ink-dim); font: 400 12.5px/1.85 var(--sans); }
.a-desc b { color: var(--gold); font-weight: 600; }
.a-facts { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: rgba(52,52,47,.7); border: 1px solid rgba(52,52,47,.7); margin-top: 14px; }
.a-facts > div { background: rgba(9,9,8,.92); padding: 9px 12px; }
.a-facts dt { color: var(--ink-faint); font: 400 9px var(--mono); letter-spacing: 2px; text-transform: uppercase; margin-bottom: 4px; }
.a-facts dd { color: var(--ink); font: 500 13px var(--mono); font-variant-numeric: tabular-nums; }
.a-src { color: var(--ink-faint); font: 400 9.5px var(--mono); letter-spacing: 1.5px; margin-top: 13px; padding-top: 10px; border-top: 1px solid rgba(52,52,47,.8); text-transform: uppercase; }
#i-back { margin-top: 14px; width: 100%; background: none; border: 1px solid rgba(212,183,132,.35); color: var(--gold); border-radius: 2px; padding: 9px 0; cursor: pointer; font: 400 11px var(--mono); letter-spacing: 2px; transition: all .18s; }
#i-back:hover { background: rgba(212,183,132,.1); }
.tl-wrap { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); width: min(780px, 92vw); z-index: 6; }
.chips { display: flex; gap: 14px; overflow-x: auto; padding: 6px 2px 10px; scrollbar-width: none; }
.chips::-webkit-scrollbar { display: none; }
.chip2 { flex: 0 0 auto; padding: 4px 1px 5px; font: 400 10px var(--mono); letter-spacing: 1.8px; color: var(--ink-dim); cursor: pointer; white-space: nowrap; border-bottom: 1px solid transparent; text-transform: uppercase; transition: color .15s; }
.chip2::before { content: ''; display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: var(--c, #d4b784); margin-right: 7px; vertical-align: 1.5px; opacity: .85; }
.chip2:hover { color: var(--ink); }
.chip2.on { color: var(--gold); border-bottom-color: var(--gold); }
.chip2.off { opacity: .28; }
.timeline { position: relative; height: 26px; cursor: pointer; }
.tl-track { position: absolute; left: 0; right: 0; top: 12px; height: 1px; background: rgba(185,178,164,.22); }
.tl-fill { position: absolute; left: 0; top: 12px; height: 1px; background: linear-gradient(90deg, rgba(212,183,132,.35), #d4b784); }
.tl-dot { position: absolute; top: 8px; width: 9px; height: 9px; margin-left: -4.5px; border-radius: 50%; background: #d4b784; box-shadow: 0 0 10px rgba(212,183,132,.9); }
.tl-meta { display: flex; justify-content: space-between; color: var(--ink-faint); font: 400 9.5px var(--mono); letter-spacing: 2px; margin-top: 5px; }
.tl-meta b { color: var(--gold); font-size: 12.5px; font-weight: 500; font-variant-numeric: tabular-nums; }
@media (max-width: 720px) {
  .info { top: auto; bottom: 96px; left: 12px; right: 12px; width: auto; max-height: 34vh; padding: 14px 16px; }
  .hud { left: 14px; top: 14px; font-size: 9.5px; }
  .search { right: 12px; width: 130px; }
}
@media (prefers-reduced-motion: reduce) { .chip2, #i-back { transition: none; } }
`;

  const dataJs = `// 数据集（${spec.viaLLM ? `AI 联网整理 · ${spec.llmProvider}` : '占位（配置模型后由 AI 联网生成真实数据集）'}）
export const ATLAS = ${JSON.stringify(A, null, 2)};
`;

  return {
    'index.html': html,
    'style.css': css,
    'app.mjs': app,
    'logic.mjs': logic,
    'data.js': dataJs,
    'test/logic.test.mjs': test,
    'package.json': JSON.stringify({ name: 'app-atlas', private: true, type: 'module' }, null, 2),
  };
}

export function defectVariant(f) {
  return {
    ...f,
    'logic.mjs': f['logic.mjs'].replace(
      'return 0.05 + 0.42 * Math.exp(-a / 1.15);',
      'return 0.05 + 0.42 * Math.exp(a / 1.15); // [预设缺陷] 拖尾方向反了（应由行星处向后衰减）',
    ),
  };
}

export function fixedLogic(f) {
  return f['logic.mjs'];
}
