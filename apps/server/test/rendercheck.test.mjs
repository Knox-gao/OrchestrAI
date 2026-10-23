import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { renderCheck } from '../rendercheck.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-test-'));

test('坏页面对照组：必需图片失败 + 横向溢出 → gate=fail（缺陷检测点：不得假绿）', async () => {
  const ws = path.join(ROOT, 'experiments', 'stage1', 'fixture-bad');
  const r = await renderCheck({ wsDir: ws, label: 'bad', outDir: OUT, viewports: [{ name: 'desktop', w: 1440, h: 900 }] });
  assert.equal(r.gate.status, 'fail');
  const v = r.viewports[0];
  assert.equal(v.images.status, 'fail', '坏图必须被检出');
  assert.equal(v.overflow.status, 'fail', '横向溢出必须被检出');
  assert.ok(v.screenshot.status === 'ok' && fs.existsSync(path.join(OUT, 'bad-desktop.png')));
});

test('懒加载豁免：首屏视口之下的懒加载图未加载不计失败（缺陷检测点）', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-lazy-'));
  // 懒图必须位于 900px 视口之下（视口内的懒图按规则仍属必需）
  fs.writeFileSync(path.join(ws, 'index.html'), `<!doctype html><html><head><title>lazy</title>
<style>body{margin:0} .space{height:1200px;background:#eee}</style></head><body>
<img src="ok.png" width="100" height="100"><div class="space"></div>
<img src="never.png" loading="lazy" width="100" height="100"></body></html>`);
  fs.writeFileSync(path.join(ws, 'ok.png'), fs.readFileSync(path.join(ROOT, 'experiments', 'stage1', 'shots', 'proto-B.png')));
  const r = await renderCheck({ wsDir: ws, label: 'lazy', outDir: OUT, viewports: [{ name: 'desktop', w: 1440, h: 900 }] });
  const met = r.viewports[0].probe.metrics;
  assert.equal(met.lazy, 1, '视口下懒加载图应归类为 lazy');
  assert.equal(met.requiredFailed, 0, '必需图（ok.png）应加载成功，懒图未加载不计失败');
  assert.equal(r.gate.status, 'pass');
  fs.rmSync(ws, { recursive: true, force: true });
});

test('环境缺失：浏览器不可用 → not_run 而非 pass（缺陷检测点：禁止假绿）', async () => {
  const prev = process.env.RENDERCHECK_EDGE;
  process.env.RENDERCHECK_EDGE = 'Z:\\不存在\\browser.exe';
  const ws = path.join(ROOT, 'experiments', 'stage1', 'fixture-bad');
  const r = await renderCheck({ wsDir: ws, label: 'noenv', outDir: OUT, viewports: [{ name: 'desktop', w: 1440, h: 900 }] });
  if (prev === undefined) delete process.env.RENDERCHECK_EDGE; else process.env.RENDERCHECK_EDGE = prev;
  assert.equal(r.gate.status, 'not_run');
  assert.equal(r.gate.pass, false);
});

test('证据落盘：rendercheck.json 含时间/截图/指标（内测版默认仅桌面单视口）', async () => {
  const j = JSON.parse(fs.readFileSync(path.join(OUT, 'bad-rendercheck.json'), 'utf8'));
  assert.ok(j.at && j.viewports.length >= 1, '必须有时间与视口记录');
  // 内测版范围：默认只跑桌面视口
  const r = await renderCheck({ wsDir: path.join(ROOT, 'experiments', 'stage1', 'fixture-bad'), label: 'default-vp', outDir: OUT });
  const j2 = JSON.parse(fs.readFileSync(path.join(OUT, 'default-vp-rendercheck.json'), 'utf8'));
  assert.equal(j2.viewports.length, 1, '默认仅桌面单视口');
  assert.equal(j2.viewports[0].viewport.name, 'desktop');
  assert.ok(j2.viewports[0].screenshot.status === 'ok');
});

/* ========== M7-B3 复核新增：视口真实性回归断言 ==========
 * 背景：旧实现用 --window-size=390,844，Edge 会钳制到 ~477-518 CSS px，
 * 而截图仍按 390px 输出 → 页面按 477px 布局后被裁切，且 scrollW===clientW 恒成立，
 * overflowX 永远为 false，无法发现裁切（归档证据 ind-minimal-rendercheck.json 即此假通过）。
 * 新实现用 CDP Emulation.setDeviceMetricsOverride，必须断言三者一致。
 */
test('（诊断·非阻断）手机视口真实性：目标 390px 必须等于实际布局视口与截图宽度', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-vp-'));
  fs.writeFileSync(path.join(ws, 'index.html'), `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>vp</title>
<style>body{margin:0;font:12px monospace}nav{display:flex;gap:4px;padding:6px}
nav a{flex:0 0 auto;padding:4px 8px;border:1px solid #ccc}@media(max-width:600px){nav a{padding:3px 5px}}</style></head>
<body><nav><a>一</a><a>二</a><a>三</a><a>四</a><a>五</a></nav><h1>视口测试</h1></body></html>`);
  const r = await renderCheck({
    wsDir: ws, label: 'vim', outDir: OUT,
    viewports: [{ name: 'mobile', w: 390, h: 844 }],
  });
  const v = r.viewports[0];
  assert.equal(v.viewportMatch.status, 'ok',
    `视口必须精确匹配：target=390 clientW=${v.viewportMatch.clientW} shotW=${v.viewportMatch.shotW}`);
  assert.equal(v.viewportMatch.clientW, 390, 'CSS 布局视口必须等于 390');
  assert.equal(v.viewportMatch.shotW, 390, '截图宽度必须等于 390');
  assert.equal(v.engine, 'cdp-emulation', '必须使用 CDP 精确视口模拟');
  assert.equal(v.blocking, false, '内测版仅桌面版：移动视口不参与门禁阻断');
  fs.rmSync(ws, { recursive: true, force: true });
});

test('元素裁切检测：右溢元素必须被判为横向溢出问题（缺陷检测点）', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-clip-'));
  // 一个 2200px 固定宽块在 1440px 桌面视口内必然溢出（scrollW 会因为 overflow 容器而增大或元素右溢）
  fs.writeFileSync(path.join(ws, 'index.html'), `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>clip</title>
<style>body{margin:0} .wide{width:2200px;height:60px;background:#ddd}</style></head>
<body><div class="wide"></div><h1>裁切</h1></body></html>`);
  const r = await renderCheck({ wsDir: ws, label: 'clip', outDir: OUT, viewports: [{ name: 'desktop', w: 1440, h: 900 }] });
  const v = r.viewports[0];
  assert.equal(v.overflow.status, 'fail', '超宽元素必须被检出');
  assert.ok((v.overflow.clippedCount ?? 0) > 0, '必须上报被裁切元素数');
  assert.equal(r.gate.status, 'fail');
  fs.rmSync(ws, { recursive: true, force: true });
});
