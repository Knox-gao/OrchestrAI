/**
 * M7-B4B 生产集成层单测：风格桥接 + PagePlan 产物门禁 + 工作区测试生成。
 * 这三块是本仓库自己写的（候选包没有），必须独立证明其行为正确。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { toHex, canonicalStyleId, resolveThemeTokens } from '../generator/pageplan/style-resolver.mjs';
import { checkPagePlanHtml, staticCheckPagePlan, buildWorkspaceTest } from '../generator/pageplan/pageplan-gate.mjs';
import { renderPagePlan } from '../generator/pageplan/render.mjs';
import { CATALOG, getStyleDef } from '../generator/styles.mjs';

const PLAN = {
  schemaVersion: 'orchestrai.pageplan.v1',
  meta: { title: '测试站点', description: '描述', language: 'zh-CN' },
  userConstraints: { locked: true },
  designIntent: { concept: '测试用概念', pageDirection: 'explore', visualPrinciples: ['留白', '层级'] },
  theme: { styleId: 'neumorph-blossom', background: '#f7edf1', surface: '#ffffff', text: '#15171f', muted: '#747177', accent: '#ce125d', accentSoft: '#f0c6d6', fontMood: 'serif', density: 'airy', radius: 'rounded' },
  nodes: [
    { id: 'hero', type: 'section', variant: 'hero', title: '标题', children: [{ id: 't1', type: 'text', text: '正文' }] },
    { id: 'two', type: 'section', title: '第二章', children: [{ id: 'l1', type: 'link', label: '去第一章', href: '#hero' }] },
  ],
  unsupportedRequests: [],
};

test('toHex 覆盖 hsl / rgba / 三位与六位 hex，非法输入返回 null', () => {
  assert.equal(toHex('#ABCDEF'), '#abcdef');
  assert.equal(toHex('#abc'), '#aabbcc');
  assert.equal(toHex('hsl(0 0% 100%)'), '#ffffff');
  assert.equal(toHex('hsl(0 0% 0%)'), '#000000');
  assert.equal(toHex('rgba(255, 0, 0, 0.5)'), '#ff0000');
  assert.equal(toHex('not-a-color'), null);
});

test('canonicalStyleId 把名称/别名映射到注册表真实 ID，不认识则返回 null', () => {
  const first = CATALOG[0].id;
  assert.equal(canonicalStyleId(first, CATALOG), first);
  assert.equal(canonicalStyleId(CATALOG[0].name, CATALOG), first);
  assert.equal(canonicalStyleId('pink-neumorph', CATALOG), 'neumorph-blossom');
  assert.equal(canonicalStyleId('金星黑金', CATALOG), null);
});

test('resolveThemeTokens 输出全部为 #RRGGBB 且接受用户锁定 fontMood', () => {
  const t = resolveThemeTokens({ styleId: 'neumorph-blossom', fontMood: 'serif', getStyleDef, catalog: CATALOG, direction: 'explore' });
  for (const k of ['background', 'surface', 'text', 'muted', 'accent', 'accentSoft']) {
    assert.match(t[k], /^#[0-9a-f]{6}$/, `${k} 必须是 hex，实际 ${t[k]}`);
  }
  assert.equal(t.fontMood, 'serif', '用户锁定字体必须赢过风格默认值');
  assert.equal(t.density, 'airy', 'explore 方向应映射为 airy');
  assert.equal(t.styleId, 'neumorph-blossom');
});

test('checkPagePlanHtml 接受合法产物', () => {
  const { files } = renderPagePlan(PLAN);
  const r = checkPagePlanHtml(files['index.html'], { sectionIds: ['hero', 'two'], title: '测试站点' });
  assert.deepEqual(r.problems, []);
});

test('checkPagePlanHtml 拒绝脚本注入 / 内联处理器 / 断链锚点 / 缺失 section', () => {
  const { files } = renderPagePlan(PLAN);
  const html = files['index.html'];
  assert.ok(checkPagePlanHtml(html.replace('</body>', '<script>alert(1)</script></body>')).problems.some((p) => p.includes('非可信脚本')));
  assert.ok(checkPagePlanHtml(html.replace('<main id="main">', '<main id="main" onclick="x()">')).problems.some((p) => p.includes('内联事件')));
  assert.ok(checkPagePlanHtml(html.replace('href="#hero"', 'href="#nope"')).problems.some((p) => p.includes('锚点')));
  assert.ok(checkPagePlanHtml(html, { sectionIds: ['hero', 'missing'] }).problems.some((p) => p.includes('#missing')));
});

test('checkPagePlanHtml 拒绝非 hex 主题变量', () => {
  const { files } = renderPagePlan(PLAN);
  const html = files['index.html'].replace('--pp-bg:#f7edf1', '--pp-bg:red');
  assert.ok(checkPagePlanHtml(html).problems.some((p) => p.includes('--pp-bg')));
});

/** 在隔离目录里真实跑一次 node --test（用 process.execPath，脱离外层测试运行器的上下文） */
function runWorkspaceTests(dir) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  try {
    const out = execFileSync(process.execPath, ['--test'], { cwd: dir, encoding: 'utf8', stdio: 'pipe', env });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

test('buildWorkspaceTest 生成的用例能真实通过合法产物', () => {
  const { files } = renderPagePlan(PLAN);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'index.html'), files['index.html']);
    fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'test', 'pageplan.test.mjs'), buildWorkspaceTest({
      sectionIds: ['hero', 'two'],
      title: '测试站点',
      themeVars: ['--pp-bg', '--pp-surface', '--pp-text', '--pp-muted', '--pp-accent', '--pp-accent-soft'],
      unsupported: [],
    }));
    const r = runWorkspaceTests(dir);
    assert.equal(r.code, 0, `生成的测试应通过，实际输出：${r.out.slice(-400)}`);
    assert.match(r.out, /pass 7/, '生成的 7 条断言应全部通过');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('buildWorkspaceTest 在产物被篡改时真实失败（非空断言）', () => {
  const { files } = renderPagePlan(PLAN);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-test-bad-'));
  try {
    // 删掉第二章 → section 断言必须失败
    fs.writeFileSync(path.join(dir, 'index.html'), files['index.html'].replace(/id="two"/, 'id="two-x"'));
    fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'test', 'pageplan.test.mjs'), buildWorkspaceTest({
      sectionIds: ['hero', 'two'], title: '测试站点', unsupported: [],
    }));
    const r = runWorkspaceTests(dir);
    assert.notEqual(r.code, 0, '篡改产物后测试必须失败');
    assert.match(r.out, /fail [1-9]/, '失败计数必须大于 0');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('staticCheckPagePlan 读取落盘文件并对缺文件如实报错', () => {
  const { files } = renderPagePlan(PLAN);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-static-'));
  try {
    assert.ok(staticCheckPagePlan(dir).some((p) => p.includes('无法读取')));
    fs.writeFileSync(path.join(dir, 'index.html'), files['index.html']);
    assert.deepEqual(staticCheckPagePlan(dir, { sectionIds: ['hero'] }), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
