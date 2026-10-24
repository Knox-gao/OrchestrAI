/**
 * 站内锚点可达性的回归测试。
 *
 * 真实故障（用户日志 PMVMNLJ69）：
 *   PagePlan 一次通过、59 个节点、7 道门禁里静态门禁判死：
 *     "站内锚点无对应 id：pricing、specs"
 *
 * 查模型输出：链接写 href="#pricing"，节点 id 却是 "pricing-section" ——
 * 只差一个后缀，却因为发现得太晚（静态门禁阶段没有重试机会）阻断整次交付。
 *
 * 修复：
 *   1. 计划规范化阶段把 #x 解析到唯一语义匹配的节点
 *   2. 解析不了的锚点在 PagePlan 阶段就报错，进入重试循环
 *   3. 静态门禁的检查保留（最终防线）
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { findDanglingAnchors } from '../generator/pageplan/generate.mjs';
import { normalizePagePlanDraft } from '../generator/pageplan/normalize-draft.mjs';
import { PAGEPLAN_LIMITS } from '../generator/pageplan/schema.mjs';

const makePlan = (links, sectionIds) => ({
  nodes: sectionIds.map((id, i) => ({
    id,
    type: 'section',
    title: `Section ${i}`,
    children: i === 0
      ? links.map((href, j) => ({ id: `link-${j}`, type: 'link', label: `L${j}`, href }))
      : [{ id: `${id}-text`, type: 'text', text: 'body' }],
  })),
});

const norm = (plan) => normalizePagePlanDraft(plan, { limits: PAGEPLAN_LIMITS });

// ---------- 解析 ----------

test('#pricing 解析到 pricing-section（模型最常漏的后缀）', () => {
  const plan = makePlan(['#pricing'], ['hero-section', 'pricing-section']);
  const { draft, repairs } = norm(plan);
  assert.equal(draft.nodes[0].children[0].href, '#pricing-section');
  assert.ok(repairs.some((r) => r.action === 'resolve-fragment-anchor' && r.from === '#pricing'));
  assert.deepEqual(findDanglingAnchors(draft), []);
});

test('锚点已经正确时不做任何改写', () => {
  const plan = makePlan(['#pricing-section'], ['hero-section', 'pricing-section']);
  const { draft, repairs } = norm(plan);
  assert.equal(draft.nodes[0].children[0].href, '#pricing-section');
  assert.equal(repairs.filter((r) => r.action === 'resolve-fragment-anchor').length, 0);
});

test('多个前缀候选时不猜（#spec 同时命中 spec-details 与其子节点）', () => {
  // makePlan 会给每个 section 生成 <id>-text 子节点，
  // 所以 spec-details 与 spec-details-text 都是 'spec-' 前缀候选 → 有歧义就保守不改。
  const plan = makePlan(['#spec'], ['hero-section', 'spec-details']);
  const { draft } = norm(plan);
  assert.equal(draft.nodes[0].children[0].href, '#spec', '有歧义必须保持原样');
  assert.deepEqual(findDanglingAnchors(draft), ['spec']);
});

test('后缀唯一匹配：锚点写 feature，节点叫 main-feature', () => {
  const plan = makePlan(['#feature'], ['hero-section', 'main-feature']);
  const { draft } = norm(plan);
  assert.equal(draft.nodes[0].children[0].href, '#main-feature');
});

// ---------- 不猜测 ----------

test('无法解析的锚点保持原样（不猜），交给上层报错', () => {
  const plan = makePlan(['#specs'], ['hero-section', 'pricing-section']);
  const { draft } = norm(plan);
  assert.equal(draft.nodes[0].children[0].href, '#specs', '不得擅自改到不相干节点');
  assert.deepEqual(findDanglingAnchors(draft), ['specs']);
});

test('多个前缀候选时不猜（歧义）', () => {
  const plan = makePlan(['#spec'], ['hero-section', 'spec-a', 'spec-b']);
  const { draft } = norm(plan);
  assert.equal(draft.nodes[0].children[0].href, '#spec', '有歧义就不动');
});

// ---------- 检查覆盖范围 ----------

test('findDanglingAnchors 能查出深层节点与 tab 面板里的锚点', () => {
  const plan = {
    nodes: [{
      id: 'hero-section', type: 'section', title: 'H',
      children: [{
        id: 'deep-container', type: 'container', layout: 'stack',
        children: [{ id: 'deep-link', type: 'link', label: 'x', href: '#nowhere' }],
      }, {
        id: 'hero-tabs', type: 'tabs', label: 'T', initialTab: 'p1',
        panels: [{ id: 'p1', label: 'P1', children: [{ id: 'tab-link', type: 'link', label: 'y', href: '#alsomissing' }] }],
      }],
    }],
  };
  const dangling = findDanglingAnchors(plan).sort();
  assert.deepEqual(dangling, ['alsomissing', 'nowhere']);
});

test('外链与 mailto 不参与锚点检查', () => {
  const plan = makePlan(
    ['https://example.com', 'mailto:a@b.co', '#pricing-section'],
    ['hero-section', 'pricing-section'],
  );
  assert.deepEqual(findDanglingAnchors(plan), []);
});

test('没有 link 节点时不报错', () => {
  assert.deepEqual(findDanglingAnchors({ nodes: [] }), []);
  assert.deepEqual(findDanglingAnchors({}), []);
  assert.deepEqual(findDanglingAnchors(null), []);
});
