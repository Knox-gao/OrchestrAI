import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pagePlanStructureSignature, comparePagePlanStructures } from '../generator/pageplan/structure-signature.mjs';

const base = JSON.parse(await readFile(new URL('../../../examples/island-pageplan.json', import.meta.url), 'utf8'));
const clone = (value) => structuredClone(value);

test('structure signature ignores copy and theme but preserves real composition', () => {
  const a = clone(base); const b = clone(base);
  b.meta.title = '另一个标题'; b.theme.accent = '#123456'; b.nodes[0].title = '不同标题文案';
  assert.equal(comparePagePlanStructures(a, b).same, true);
  const c = clone(base); c.nodes[0].children.push({ id: 'new-card', type: 'container', layout: 'split', children: [{ id: 'new-heading', type: 'heading', level: 2, text: '说明' }, { id: 'new-text', type: 'text', text: '更多信息' }] });
  assert.equal(comparePagePlanStructures(a, c).same, false);
});

test('structure signature detects grid/split/section differences', () => {
  const a = clone(base); a.nodes = [{ id: 'root', type: 'container', layout: 'grid', columns: 3, children: [{ id: 'one', type: 'card', title: 'A' }, { id: 'two', type: 'card', title: 'B' }] }];
  const b = clone(a); b.nodes[0].layout = 'split'; delete b.nodes[0].columns;
  assert.notEqual(pagePlanStructureSignature(a), pagePlanStructureSignature(b));
});

test('structure signature records scene object shape mix, not object names', () => {
  const a = clone(base); const b = clone(base);
  const sceneA = a.nodes.find((node) => node.type === 'scene3d');
  const sceneB = b.nodes.find((node) => node.type === 'scene3d');
  sceneB.objects[0].name = '另一种命名';
  assert.equal(comparePagePlanStructures(a, b).same, true);
  sceneB.objects[0].shape = 'sphere';
  assert.equal(comparePagePlanStructures(a, b).same, false);
  assert.equal(pagePlanStructureSignature(a).includes('shapeCounts'), true);
});

test('invalid plan without nodes is rejected', () => {
  assert.throws(() => pagePlanStructureSignature({}), /plan.nodes is required/);
});
