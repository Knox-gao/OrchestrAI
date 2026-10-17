/**
 * H1 实验：真实图片的元数据与色彩特征提取可行性
 *   - PNG：自研最小解码（IHDR/PLTE/IDAT + inflate + unfilter，8bit 真彩/灰度/调色板）
 *   - JPEG：成品 jpeg-js（纯 JS，零原生依赖，隔离安装于 experiments/stage1/node_modules）
 *   - 特征：宽高/比例/体积 + 平均色/亮度/饱和度 + 量化主色 top3（4×4×4 桶）
 * 产出：h1-result.json（逐样本结果 + 汇总指标），供阶段报告引用。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const jpeg = require('jpeg-js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

/** 最小 PNG 解码：返回 {width,height,data:Uint8Array(RGBA)}，不支持时抛出原因 */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('非PNG签名');
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
      if (data[12] !== 0) throw new Error('不支持交错(interlace)');
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
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    for (let x = 0; x < stride; x++) {
      const b = raw[p + x];
      const a = x >= channels ? cur[x - channels] : 0;
      const bb = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v;
      switch (filter) {
        case 0: v = b; break;
        case 1: v = b + a; break;
        case 2: v = b + bb; break;
        case 3: v = b + ((a + bb) >> 1); break;
        case 4: {
          const pp = a + bb - c, pa = Math.abs(pp - a), pb = Math.abs(pp - bb), pc = Math.abs(pp - c);
          v = b + (pa <= pb && pa <= pc ? a : pb <= pc ? bb : c);
          break;
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
      else if (colorType === 0) { const g = cur[s]; out[o] = out[o + 1] = out[o + 2] = g; out[o + 3] = 255; }
      else if (colorType === 4) { const g = cur[s]; out[o] = out[o + 1] = out[o + 2] = g; out[o + 3] = cur[s + 1]; }
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

function decodeJpeg(buf) {
  const r = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
  return { width: r.width, height: r.height, data: r.data };
}

/** 色彩特征：采样步长自适应（目标 ≤2 万采样点） */
function colorFeatures({ width, height, data }) {
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
    const key = ((r >> 6) << 8) | ((g >> 6) << 4) | (b >> 6); // 4×4×4 量化
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

/* ---------- 主流程 ---------- */
const files = [];
for (const ws of fs.readdirSync(path.join(ROOT, 'workspaces')).sort().reverse()) {
  const dir = path.join(ROOT, 'workspaces', ws, 'images');
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (/\.(jpg|jpeg|png)$/i.test(f)) files.push(path.join(dir, f));
  }
  if (files.length > 400) break;
}
// 均衡抽样：PNG 12 张 + JPEG 28 张
const pngs = files.filter((f) => /\.png$/i.test(f)).slice(0, 12);
const jpgs = files.filter((f) => /\.jpe?g$/i.test(f)).slice(0, 28);
const sample = [...pngs, ...jpgs];

const results = [];
for (const f of sample) {
  const t0 = performance.now();
  const rec = { file: path.basename(f).slice(0, 24), ws: path.basename(path.dirname(path.dirname(f))), kb: Math.round(fs.statSync(f).size / 1024) };
  try {
    const buf = fs.readFileSync(f);
    const isPng = /\.png$/i.test(f);
    const dec = isPng ? decodePng(buf) : decodeJpeg(buf);
    const feats = colorFeatures(dec);
    const ms = +(performance.now() - t0).toFixed(1);
    results.push({ ...rec, ok: true, fmt: isPng ? 'png(自研)' : 'jpeg(jpeg-js)', w: dec.width, h: dec.height, ms, aspect: +(dec.width / dec.height).toFixed(3), ...feats });
  } catch (e) {
    results.push({ ...rec, ok: false, fmt: /\.png$/i.test(f) ? 'png(自研)' : 'jpeg(jpeg-js)', err: String(e.message).slice(0, 60) });
  }
}
const byFmt = {};
for (const r of results) {
  byFmt[r.fmt] ??= { total: 0, ok: 0, avgMs: 0 };
  byFmt[r.fmt].total++;
  if (r.ok) { byFmt[r.fmt].ok++; byFmt[r.fmt].avgMs += r.ms; }
}
for (const k of Object.keys(byFmt)) if (byFmt[k].ok) byFmt[k].avgMs = +(byFmt[k].avgMs / byFmt[k].ok).toFixed(1);

const summary = {
  sampleTotal: sample.length, sources: 'workspaces/*/images（真实采集图）',
  byFormat: byFmt,
  okRate: +(results.filter((r) => r.ok).length / results.length).toFixed(3),
  biggestDim: results.filter((r) => r.ok).reduce((a, r) => Math.max(a, r.w * r.h), 0),
};
fs.writeFileSync(path.join(HERE, 'h1-result.json'), JSON.stringify({ summary, results }, null, 1));
console.log(JSON.stringify(summary, null, 1));
console.log('失败样本:', results.filter((r) => !r.ok).map((r) => r.file + ':' + r.err).join(' | ') || '无');
