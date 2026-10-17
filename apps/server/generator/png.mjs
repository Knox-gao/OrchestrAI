/**
 * 零依赖 PNG 编码器（RGBA 8bit，zlib deflate）—— 用于程序化生成应用图标。
 */
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

/** pixel(x, y) → [r, g, b, a] */
export function encodePng(width, height, pixel) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = rowStart + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * 应用图标：圆角方块（accent 底色 + 暗色描边）+ 白色像素闪电。
 * @param {number} size 192 / 512
 */
export function appIcon(size, accentHex) {
  const segs = [
    [0.62, 0.16, 0.36, 0.52],
    [0.36, 0.52, 0.58, 0.52],
    [0.58, 0.52, 0.34, 0.86],
  ];
  return iconPaint(size, accentHex, (x, y, s, c) => c.seg(segs[0][0], segs[0][1], segs[0][2], segs[0][3]) || c.seg(segs[1][0], segs[1][1], segs[1][2], segs[1][3]) || c.seg(segs[2][0], segs[2][1], segs[2][2], segs[2][3]));
}

/** 通用图标绘制底座：圆角方块 + 描边，glyph(x, y, size, 线段命中, 圆/矩形命中) 返回是否涂白 */
function iconPaint(size, accentHex, glyph) {
  const [r, g, b] = hexToRgb(accentHex);
  const dark = [Math.round(r * 0.55), Math.round(g * 0.55), Math.round(b * 0.55)];
  const c = size / 2;
  const half = size * 0.46;
  const radius = size * 0.2;
  const stroke = size * 0.032;
  const bolt = size * 0.085;
  const segs = [
    [0.62, 0.16, 0.36, 0.52],
    [0.36, 0.52, 0.58, 0.52],
    [0.58, 0.52, 0.34, 0.86],
  ];
  const onBolt = (x, y, s) => segs.some(([ax, ay, bx2, by2]) => distToSeg(x, y, ax * s, ay * s, bx2 * s, by2 * s) < bolt);
  const inRound = (x, y, s) => {
    const qx = Math.abs(x - s / 2) - (s * 0.46 - s * 0.2);
    const qy = Math.abs(y - s / 2) - (s * 0.46 - s * 0.2);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - s * 0.2;
  };
  return encodePng(size, size, (x, y) => {
    const dist = inRound(x, y, size);
    if (dist > 0) return [0, 0, 0, 0];
    const ctx = {
      seg: (ax, ay, bx2, by2, w) => distToSeg(x, y, ax * size, ay * size, bx2 * size, by2 * size) < (w ?? size * 0.05),
      rect: (l, t, rt, bm) => x >= l * size && x <= rt * size && y >= t * size && y <= bm * size,
      circle: (cx, cy, rad) => Math.hypot(x - cx * size, y - cy * size) < rad * size,
    };
    if (glyph(x, y, size, ctx)) return [255, 255, 255, 255];
    if (Math.abs(dist) < stroke) return [...dark, 255];
    return [r, g, b, 255];
  });
}

/** 按模板类型绘制专属图标（todo✓ pomodoro🍅 counter▤ notes✎ gallery🖼 countdown🗓） */
export function appIconFor(type, size, accentHex) {
  const glyphs = {
    // 对勾
    todo: (x, y, _s, c) => c.seg(0.22, 0.54, 0.42, 0.72) || c.seg(0.42, 0.72, 0.78, 0.30),
    // 番茄：圆 + 顶部蒂
    pomodoro: (x, y, _s, c) => c.circle(0.5, 0.58, 0.26) || c.rect(0.46, 0.22, 0.54, 0.34),
    // 四根计数柱
    counter: (x, y, _s, c) =>
      c.rect(0.22, 0.28, 0.30, 0.72) || c.rect(0.40, 0.28, 0.48, 0.72) ||
      c.rect(0.58, 0.28, 0.66, 0.72) || c.rect(0.74, 0.28, 0.82, 0.72),
    // 铅笔（斜杆 + 笔尖点）
    notes: (x, y, _s, c) => c.seg(0.32, 0.68, 0.66, 0.34, 0.06) || c.circle(0.30, 0.70, 0.05),
    // 相框：外框环 + 太阳 + 山形
    gallery: (x, y, s, c) => {
      const ring = c.rect(0.18, 0.24, 0.82, 0.76) && !(x > 0.25 * s && x < 0.75 * s && y > 0.31 * s && y < 0.69 * s);
      const sun = c.circle(0.38, 0.41, 0.055);
      const mountain = c.seg(0.30, 0.62, 0.46, 0.47, 0.04) || c.seg(0.46, 0.47, 0.58, 0.58, 0.04) || c.seg(0.54, 0.52, 0.66, 0.44, 0.04);
      return ring || sun || mountain;
    },
    // 日历：外框环 + 两个装订钉 + 头部横线 + 一个焦点日
    countdown: (x, y, s, c) => {
      const ring = c.rect(0.20, 0.28, 0.80, 0.78) && !(x > 0.26 * s && x < 0.74 * s && y > 0.35 * s && y < 0.72 * s);
      const pins = c.rect(0.34, 0.18, 0.40, 0.32) || c.rect(0.60, 0.18, 0.66, 0.32);
      const focus = c.rect(0.30, 0.46, 0.42, 0.58);
      return ring || pins || focus;
    },
  };
  const glyph = glyphs[type] ?? null;
  if (!glyph) return appIcon(size, accentHex);
  return iconPaint(size, accentHex, (x, y, s, c) => glyph(x, y, s, c));
}

/** 本地示意卡（网络图源不可达时的诚实兜底素材） */
export function placeholderCard(w, h, accentHex, idx) {
  const [r, g, b] = hexToRgb(accentHex);
  const c1 = [Math.round(r * 0.35), Math.round(g * 0.35), Math.round(b * 0.4)];
  const c2 = [Math.round(r * 0.75), Math.round(g * 0.7), Math.round(b * 0.65)];
  const cx = w * (0.3 + 0.12 * (idx % 3));
  const cy = h * (0.35 + 0.1 * (idx % 2));
  const R = Math.min(w, h) * 0.26;
  const bolt = Math.min(w, h) * 0.06;
  const segs = [
    [cx + R * 0.25, cy - R * 0.8, cx - R * 0.3, cy + R * 0.15],
    [cx - R * 0.3, cy + R * 0.15, cx + R * 0.2, cy + R * 0.15],
    [cx + R * 0.2, cy + R * 0.15, cx - R * 0.35, cy + R * 0.85],
  ];
  return encodePng(w, h, (x, y) => {
    const t = (x / w + y / h) / 2;
    let rr = Math.round(c1[0] + (c2[0] - c1[0]) * t);
    let gg = Math.round(c1[1] + (c2[1] - c1[1]) * t);
    let bb = Math.round(c1[2] + (c2[2] - c1[2]) * t);
    // 网格纹理
    if (x % 32 === 0 || y % 32 === 0) { rr = Math.round(rr * 0.85); gg = Math.round(gg * 0.85); bb = Math.round(bb * 0.85); }
    if (Math.hypot(x - cx, y - cy) < R) {
      const on = segs.some(([ax, ay, bx2, by2]) => distToSeg(x, y, ax, ay, bx2, by2) < bolt);
      if (on) return [255, 255, 255, 235];
      rr = Math.round(rr * 0.7); gg = Math.round(gg * 0.7); bb = Math.round(bb * 0.7);
    }
    return [rr, gg, bb, 255];
  });
}
