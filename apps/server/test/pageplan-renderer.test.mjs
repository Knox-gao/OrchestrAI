import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validatePagePlan, PagePlanValidationError, PAGEPLAN_SCHEMA_VERSION } from '../generator/pageplan/schema.mjs';
import { renderPagePlan, PagePlanBlockedError } from '../generator/pageplan/render.mjs';
import { registerPagePlanRenderer } from '../generator/pageplan/registry.mjs';

const sample = JSON.parse(await readFile(new URL('../../../examples/island-pageplan.json', import.meta.url), 'utf8'));

function clone(value) { return structuredClone(value); }

test('valid PagePlan validates and emits a standalone HTML file', () => {
  const result = renderPagePlan(sample);
  assert.equal(Object.keys(result.files).length, 1);
  assert.ok(result.files['index.html'].startsWith('<!doctype html>'));
  assert.match(result.files['index.html'], /lang="zh-CN"/);
  assert.match(result.files['index.html'], /<h1[^>]*>一座会呼吸的果冻海岛<\/h1>/);
  assert.match(result.files['index.html'], /<main id="main">/);
  assert.match(result.files['index.html'], /data-pageplan-scene3d/, 'example includes a real scene3d node');
  assert.match(result.files['index.html'], /getContext\('webgl'/, '3D runtime initializes WebGL rather than drawing a 2D imitation');
  assert.equal(result.report.features.scene3d.scenes, 1);
  assert.equal(result.report.features.scene3d.objects, 14);
  assert.equal(result.report.features.scene3d.renderer, 'WebGL1-local-no-dependencies');
  assert.equal(result.report.mobileLayoutDelivery, false, 'component-level responsive controls do not imply mobile-site delivery');
  assert.equal(result.report.schemaVersion, PAGEPLAN_SCHEMA_VERSION);
  assert.equal(result.report.nodeCount, 13);
});

test('all user hard choices must match the final PagePlan metadata and theme', () => {
  const plan = clone(sample);
  plan.theme.styleId = 'clay-obsidian';
  assert.throws(() => validatePagePlan(plan), PagePlanValidationError);
  const font = clone(sample);
  font.theme.fontMood = 'sans';
  assert.throws(() => validatePagePlan(font), /fontMood conflicts/);
  const direction = clone(sample);
  direction.designIntent.pageDirection = 'showcase';
  assert.throws(() => validatePagePlan(direction), /pageDirection conflicts/);
});

test('unknown node types and unknown properties fail closed', () => {
  const unknown = clone(sample);
  unknown.nodes[0].children.push({ id: 'wild-node', type: 'run-script', code: 'alert(1)' });
  assert.throws(() => validatePagePlan(unknown), /unsupported renderer type/);
  const extra = clone(sample);
  extra.nodes[0].onClick = 'doAnything()';
  assert.throws(() => validatePagePlan(extra), /unsupported property/);
});

test('duplicate ids and invalid colors are rejected', () => {
  const dup = clone(sample);
  dup.nodes.push({ id: 'island-intro', type: 'divider' });
  assert.throws(() => validatePagePlan(dup), /duplicate id/);
  const badColor = clone(sample);
  badColor.theme.accent = 'url(javascript:alert(1))';
  assert.throws(() => validatePagePlan(badColor), /expected #RRGGBB/);
});

test('unsafe protocols are rejected for links and images', () => {
  const badHref = clone(sample);
  badHref.nodes[0].children[1].href = 'javascript:alert(1)';
  assert.throws(() => validatePagePlan(badHref), /unsafe URL/);
  const badImg = clone(sample);
  badImg.nodes[0].children.push({ id: 'bad-image', type: 'image', src: 'file:///C:/secret.txt', alt: 'unsafe' });
  assert.throws(() => validatePagePlan(badImg), /unsafe URL/);
  const credentialed = clone(sample);
  credentialed.nodes[0].children[1].href = 'https://user:password@example.com/path';
  assert.throws(() => validatePagePlan(credentialed), /unsafe URL/);
  const protocolRelative = clone(sample);
  protocolRelative.nodes[0].children[1].href = '//evil.example/path';
  assert.throws(() => validatePagePlan(protocolRelative), /unsafe URL/);
});

test('model strings are escaped and generated HTML does not include model-supplied scripts', () => {
  const plan = clone(sample);
  plan.meta.title = '<script>alert(1)</script>';
  plan.nodes[0].title = '<img src=x onerror=alert(1)>';
  plan.nodes[0].children[0].text = '</p><script>alert(1)</script>';
  const { files } = renderPagePlan(plan);
  const html = files['index.html'];
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<[^>]+\sonerror\s*=/i);
});

test('interactive disclosures are native HTML, no arbitrary event handlers are generated', () => {
  const { files, report } = renderPagePlan(sample);
  const html = files['index.html'];
  assert.match(html, /<details/);
  assert.match(html, /<summary/);
  assert.doesNotMatch(html, /\son(?:click|load|error)\s*=/i);
  assert.equal(report.features.nativeDetails, 4);
});

test('blocking unsupported requests prevent rendering while nonblocking limits are visible', () => {
  const blocked = clone(sample);
  blocked.unsupportedRequests.push({ requirementId: 'US1-3D', capability: '真实 3D 岛屿场景', reason: '当前没有注册且通过验收的 3D 场景渲染器', severity: 'blocking' });
  assert.throws(() => renderPagePlan(blocked), PagePlanBlockedError);
  const disclosed = clone(sample);
  disclosed.unsupportedRequests.push({ requirementId: 'US1-AUDIO', capability: '环境音效', reason: '本次版本没有音频播放模块', severity: 'nonblocking' });
  const output = renderPagePlan(disclosed);
  assert.match(output.files['index.html'], /本次生成的已知限制/);
  assert.match(output.files['index.html'], /环境音效/);
  assert.equal(output.report.unsupportedRequests.length, 1);
});

test('a trusted extension renderer can add a typed capability without evaluating model code', () => {
  const unregister = registerPagePlanRenderer('custom-scene-test', {
    validate(node) {
      return typeof node.id === 'string' && typeof node.label === 'string' && Object.keys(node).every((k) => ['id', 'type', 'label'].includes(k));
    },
    render(node, context) {
      return `<div id="${context.escapeAttribute(node.id)}" role="img" aria-label="${context.escapeAttribute(node.label)}"></div>`;
    },
  });
  try {
    const plan = clone(sample);
    plan.nodes.push({ id: 'test-scene', type: 'custom-scene-test', label: '<scene label>' });
    const html = renderPagePlan(plan).files['index.html'];
    assert.match(html, /role="img" aria-label="&lt;scene label&gt;"/);
  } finally {
    unregister();
  }
});
