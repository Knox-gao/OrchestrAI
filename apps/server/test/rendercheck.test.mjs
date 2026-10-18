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

test('证据落盘：rendercheck.json 含时间/截图/指标且双视口齐全', async () => {
  const j = JSON.parse(fs.readFileSync(path.join(OUT, 'bad-rendercheck.json'), 'utf8'));
  // 前面的用例都是单视口（bad）；补一个双视口真实验证
  const r = await renderCheck({ wsDir: path.join(ROOT, 'experiments', 'stage1', 'fixture-bad'), label: 'dual', outDir: OUT,
    viewports: [{ name: 'desktop', w: 1440, h: 900 }, { name: 'mobile', w: 390, h: 844 }] });
  const j2 = JSON.parse(fs.readFileSync(path.join(OUT, 'dual-rendercheck.json'), 'utf8'));
  assert.ok(j.at && j.viewports.length >= 1);
  assert.equal(j2.viewports.length, 2, '双视口必须都执行');
  assert.ok(j2.viewports.every((v) => v.screenshot.status === 'ok'));
});
