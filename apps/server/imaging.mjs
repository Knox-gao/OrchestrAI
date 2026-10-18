/**
 * 图片成像层（阶段二任务 C）：解码（PNG 自研 / JPEG vendor）+ 色彩特征 + 来源媒介分类
 * 来自阶段一 H1 实验（40/40 真实样本验证，PNG 平均 20.6ms / JPEG 平均 143.5ms）。
 * vendor/jpeg-decoder.cjs：jpeg-js decoder（Apache-2.0, Copyright 2011 notmasteryet）。
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const jpegDecode = require('./vendor/jpeg-decoder.cjs');

export function decodeImage(buf, extHint) {
  if (buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50) return decodePng(buf);
  if (buf[0] === 0xff && buf[1] === 0xd8) return jpegDecode(buf, { useTArray: true, formatAsRGBA: true });
  if (extHint === 'png') return decodePng(buf);
  return jpegDecode(buf, { useTArray: true, formatAsRGBA: true });
}

function decodePng(buf) {
  let off = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  let palette = null, trns = null;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (data[12] !== 0) throw new Error('不支持交错PNG');
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`不支持位深${bitDepth}`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`不支持颜色类型${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride), cur = new Uint8Array(stride), p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    for (let x = 0; x < stride; x++) {
      const b = raw[p + x];
      const a = x >= channels ? cur[x - channels] : 0;
      const bb = prev[x], c = x >= channels ? prev[x - channels] : 0;
      let v;
      switch (filter) {
        case 0: v = b; break;
        case 1: v = b + a; break;
        case 2: v = b + bb; break;
        case 3: v = b + ((a + bb) >> 1); break;
        case 4: {
          const pp = a + bb - c, pa = Math.abs(pp - a), pb = Math.abs(pp - bb), pc = Math.abs(pp - c);
          v = b + (pa <= pb && pa <= pc ? a : pb <= pc ? bb : c); break;
        }
        default: throw new Error(`未知过滤器${filter}`);
      }
      cur[x] = v & 255;
    }
    p += stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4, s = x * channels;
      if (colorType === 6) { out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = cur[s + 3]; }
      else if (colorType === 2) { out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = 255; }
      else if (colorType === 0 || colorType === 4) { const g = cur[s]; out[o] = out[o + 1] = out[o + 2] = g; out[o + 3] = colorType === 4 ? cur[s + 1] : 255; }
      else if (colorType === 3) {
        const idx = cur[s] * 3;
        if (!palette) throw new Error('调色板缺失');
        out[o] = palette[idx]; out[o + 1] = palette[idx + 1]; out[o + 2] = palette[idx + 2];
        out[o + 3] = trns && cur[s] < trns.length ? trns[cur[s]] : 255;
      }
    }
    const t = prev; prev = cur; cur = t;
  }
  return { width, height, data: out };
}

/** 色彩特征（≤2 万采样点）：平均色/亮度/饱和度/主色top3/透明占比 */
export function colorFeatures({ width, height, data }) {
  const total = width * height;
  const step = Math.max(1, Math.floor(total / 20000));
  let n = 0, sr = 0, sg = 0, sb = 0, bright = 0, sat = 0, alpha0 = 0;
  const buckets = new Map();
  for (let i = 0; i < total; i += step) {
    const o = i * 4;
    if (data[o + 3] < 32) { alpha0++; continue; }
    const r = data[o], g = data[o + 1], b = data[o + 2];
    sr += r; sg += g; sb += b; n++;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    bright += (mx + mn) / 2;
    sat += mx === 0 ? 0 : (mx - mn) / mx;
    const key = ((r >> 6) << 8) | ((g >> 6) << 4) | (b >> 6);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const dom = [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, c]) => ({ hex: '#' + [((k >> 8) & 15) * 17, ((k >> 4) & 15) * 17, (k & 15) * 17].map((v) => v.toString(16).padStart(2, '0')).join(''), ratio: +(c / n).toFixed(3) }));
  return {
    avgRgb: [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)],
    brightness: +(bright / n).toFixed(1),
    saturation: +(sat / n).toFixed(3),
    dominant: dom,
    transparentRatio: +(alpha0 / (alpha0 + n)).toFixed(3),
  };
}

/** 文件级特征：解码 + 尺寸/比例 + 色彩（一次读取） */
export function imageFeaturesFromFile(fp) {
  return imageFeaturesFromBuf(fs.readFileSync(fp), path.extname(fp).toLowerCase());
}

/** 缓冲级特征（curator 对内存候选评分用） */
export function imageFeaturesFromBuf(buf, extHint = '') {
  const ext = String(extHint).toLowerCase().replace('.', '').replace('jpeg', 'jpg');
  const dec = decodeImage(buf, ext);
  return { ok: true, width: dec.width, height: dec.height, aspect: +(dec.width / dec.height).toFixed(3), bytes: buf.length, ...colorFeatures(dec) };
}

/** 来源媒介分类（辅助信号，不等于视觉风格判定）：百科/官方/新闻/图库/社区/未知 */
export function mediaClass(author = '', page = '') {
  const s = `${author} ${page}`.toLowerCase();
  if (/baike|wiki|百科/.test(s)) return 'encyclopedia';
  if (/\.com\/(news|article)|新闻|sina|qq\.com|3dm|vogue/.test(s)) return 'news';
  if (/pexels|unsplash|nipic|huaban|shetu|摄图|昵图|花瓣/.test(s)) return 'stock';
  if (/reddit|weibo|twitter|fan|社区/.test(s)) return 'community';
  if (/official|官网|marvel\.com|disney/.test(s)) return 'official';
  return 'unknown';
}
