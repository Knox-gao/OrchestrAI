/**
 * M7-B4H：PagePlan 草稿确定性规范化（校验前机械修复）。
 *
 * 真实故障：deepseek 两轮 PAGEPLAN_INVALID，第二轮只剩
 * `timeline.items[0]: unsupported property "type"` —— 模型给时间线条目
 * 多写了个 type 字段。这类纯机械噪声不该吃掉一整轮重试，更不该让整次生成失败。
 *
 * 这一层的边界必须被测试锁死：
 *   - 只清机械噪声，不发明内容（缺文案、缺 items 一律留给校验拒）
 *   - 清理后仍然跑完整校验，门槛不降
 *   - 修了什么要能上报，不静默
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizePagePlanDraft } from '../generator/pageplan/normalize-draft.mjs';
import { validatePagePlan, PAGEPLAN_LIMITS } from '../generator/pageplan/schema.mjs';

const sample = JSON.parse(await readFile(new URL('../../../examples/island-pageplan.json', import.meta.url), 'utf8'));
const base = () => structuredClone(sample);
const norm = (plan) => normalizePagePlanDraft(plan, { limits: PAGEPLAN_LIMITS });

const findNode = (nodes, pred) => {
  for (const n of nodes ?? []) {
    if (pred(n)) return n;
    const hit = findNode(n.children, pred) ?? findNode((n.panels ?? []).flatMap((p) => p.children ?? []), pred);
    if (hit) return hit;
  }
  return null;
};

// ---------- 1. 多余字段 ----------

test('timeline.items 上的多余字段被清掉，正文内容完整保留', () => {
  const plan = base();
  const tl = findNode(plan.nodes, (n) => n.type === 'timeline');
  assert.ok(tl, '样例句型里应当有 timeline 节点');
  const before = structuredClone(tl.items[0]);
  tl.items[0].type = 'phase-tokens';

  const { draft, repairs } = norm(plan);
  const after = findNode(draft.nodes, (n) => n.type === 'timeline').items[0];

  assert.equal('type' in after, false, '多余 type 必须被移除');
  assert.equal(after.title, before.title, 'title 不得改动');
  assert.equal(after.body, before.body, 'body 不得改动');
  assert.equal(after.date, before.date, 'date 不得改动');
  assert.ok(repairs.some((r) => r.action === 'strip-unknown-keys' && r.keys.includes('type')));
});

test('list.items 上的多余字段被清掉', () => {
  const plan = base();
  const section = plan.nodes.find((n) => n.type === 'section');
  // 夹具里没有 list 节点，手工挂一个，专测 items 白名单
  section.children.push({
    id: 'extra-list', type: 'list',
    items: [{ title: '第一项', text: '正文', id: 'extra-id', body: '不该出现' }],
  });

  const { draft, repairs } = norm(plan);
  const after = findNode(draft.nodes, (n) => n.id === 'extra-list');
  assert.ok(after, 'list 节点必须保留');
  assert.equal('id' in after.items[0], false);
  assert.equal('body' in after.items[0], false);
  assert.equal(after.items[0].title, '第一项');
  assert.equal(after.items[0].text, '正文');
  assert.ok(repairs.some((r) => r.action === 'strip-unknown-keys'));
});

// ---------- 2. 空 children ----------

test('card 的空 children 只去掉键，卡片本身与文案全部保留', () => {
  const plan = base();
  const card = findNode(plan.nodes, (n) => n.type === 'card');
  assert.ok(card);
  const title = card.title;
  card.children = [];

  const { draft, repairs } = norm(plan);
  const after = findNode(draft.nodes, (n) => n.title === title);
  assert.ok(after, '卡片不能被整体删除');
  assert.equal('children' in after, false);
  assert.equal(after.title, title);
  assert.ok(repairs.some((r) => r.action === 'drop-empty-children-key'));
});

test('section 的 children 被清空后整个节点摘除，不留空壳', () => {
  const plan = base();
  const section = plan.nodes.find((n) => n.type === 'section');
  assert.ok(section);
  const id = section.id;
  section.children = [];

  const { draft, repairs } = norm(plan);
  assert.equal(draft.nodes.some((n) => n.id === id), false, '空 section 必须被摘除');
  assert.ok(repairs.some((r) => r.action === 'drop-node-with-empty-children'));
});

// ---------- 3. columns 只在 grid ----------

test('非 grid 容器上的 columns 被移除', () => {
  const plan = base();
  const section = plan.nodes.find((n) => n.type === 'section');
  section.children.push({
    id: 'extra-stack', type: 'container', layout: 'stack', columns: 3,
    children: [{ id: 'extra-text', type: 'text', text: '内容' }],
  });

  const { draft, repairs } = norm(plan);
  const after = findNode(draft.nodes, (n) => n.id === 'extra-stack');
  assert.ok(after, '容器必须保留');
  assert.equal('columns' in after, false, 'stack 布局不该有 columns');
  assert.ok(repairs.some((r) => r.action === 'drop-columns-outside-grid'));
});

test('grid 容器上的 columns 保持原样', () => {
  const plan = base();
  const section = plan.nodes.find((n) => n.type === 'section');
  section.children.push({
    id: 'extra-grid', type: 'container', layout: 'grid', columns: 3,
    children: [{ id: 'extra-text2', type: 'text', text: '内容' }],
  });

  const { draft } = norm(plan);
  const after = findNode(draft.nodes, (n) => n.id === 'extra-grid');
  assert.equal(after.columns, 3, 'grid 的 columns 必须保留');
});

// ---------- 4. 重复 id ----------

test('重复 id 被改成唯一后缀，不丢节点', () => {
  const plan = base();
  const cards = [];
  const collect = (nodes) => (nodes ?? []).forEach((n) => {
    if (n.type === 'card') cards.push(n);
    collect(n.children);
    (n.panels ?? []).forEach((p) => collect(p.children));
  });
  collect(plan.nodes);
  assert.ok(cards.length >= 2, '需要至少两张卡片才能造重复 id');
  const dup = cards[0].id;
  cards[1].id = dup;
  const countBefore = cards.length;

  const { draft, repairs } = norm(plan);
  const cardsAfter = [];
  const collect2 = (nodes) => (nodes ?? []).forEach((n) => {
    if (n.type === 'card') cardsAfter.push(n);
    collect2(n.children);
    (n.panels ?? []).forEach((p) => collect2(p.children));
  });
  collect2(draft.nodes);

  assert.equal(cardsAfter.length, countBefore, '节点数量不得减少');
  const ids = cardsAfter.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'id 必须唯一');
  assert.ok(repairs.some((r) => r.action === 'rename-duplicate-id'));
});

// ---------- 5. 元数据截断 ----------

test('visualPrinciples 超量时截断并记录，且截断后能通过校验', () => {
  const plan = base();
  plan.designIntent.visualPrinciples = Array.from({ length: 20 }, (_, i) => `原则 ${i}`);
  assert.throws(() => validatePagePlan(plan), /at most 12/);

  const { draft, repairs } = norm(plan);
  assert.equal(draft.designIntent.visualPrinciples.length, 12);
  assert.doesNotThrow(() => validatePagePlan(draft));
  assert.ok(repairs.some((r) => r.action === 'truncate-items'));
});

test('visualPrinciples 单项超长时截断到上限', () => {
  const plan = base();
  plan.designIntent.visualPrinciples = ['x'.repeat(400)];
  const { draft } = norm(plan);
  assert.equal(draft.designIntent.visualPrinciples[0].length, PAGEPLAN_LIMITS.maxVisualPrincipleLength);
  assert.doesNotThrow(() => validatePagePlan(draft));
});

test('卡片重复 tag 去重后能通过校验', () => {
  const plan = base();
  const card = findNode(plan.nodes, (n) => n.type === 'card' && Array.isArray(n.tags) && n.tags.length > 0);
  if (!card) return;
  card.tags = [card.tags[0], card.tags[0]];
  const { draft } = norm(plan);
  const after = findNode(draft.nodes, (n) => n.id === card.id);
  assert.equal(new Set(after.tags).size, after.tags.length);
  assert.doesNotThrow(() => validatePagePlan(draft));
});

// ---------- 6. 绝不发明内容（边界） ----------

test('缺少必填 title 的 section 不会被补内容，仍然被校验拒绝', () => {
  const plan = base();
  const section = plan.nodes.find((n) => n.type === 'section');
  delete section.title;
  const { draft } = norm(plan);
  assert.throws(() => validatePagePlan(draft), /section\.title|title/);
});

test('timeline 缺 items 时不会被凭空生成条目', () => {
  const plan = base();
  const tl = findNode(plan.nodes, (n) => n.type === 'timeline');
  const before = tl.items.length;
  delete tl.items;
  const { draft } = norm(plan);
  const after = findNode(draft.nodes, (n) => n.id === tl.id);
  assert.equal('items' in after, false, '不得凭空补 items');
  assert.throws(() => validatePagePlan(draft));
  assert.ok(before > 0);
});

test('完全合法的计划不被改动，也不产生任何修复记录', () => {
  const plan = base();
  const snapshot = JSON.stringify(plan);
  const { draft, repairs } = norm(plan);
  assert.equal(JSON.stringify(draft), snapshot, '合法计划必须原样通过');
  assert.equal(repairs.length, 0, '不应有无意义的修复记录');
});

test('空对象与非法输入不抛异常，原样返回', () => {
  for (const input of [null, undefined, 42, 'text', []]) {
    const r = normalizePagePlanDraft(input, { limits: PAGEPLAN_LIMITS });
    assert.deepEqual(r.repairs, []);
  }
});

// ---------- 7. scene3d 机械修复 ----------

test('scene3d.height 像素数字映射到最近的枚举档', () => {
  const plan = base();
  const section = plan.nodes.find((n) => n.type === 'section');
  section.children.push({
    id: 'sc-test', type: 'scene3d', label: '场景', description: '描述',
    height: 480, background: '#101018', cameraDistance: 20,
    controls: { orbit: true, zoom: true, autoRotate: false, dayNight: false, tide: false },
    objects: [{
      id: 'rock-1', name: '岩石', shape: 'rock',
      position: [0, 0, 0], scale: [1, 1, 1], rotation: [0, 0, 0],
      color: '#334455', material: 'stone', description: '', selectable: false, motion: 'none',
    }],
  });

  const { draft, repairs } = norm(plan);
  const after = findNode(draft.nodes, (n) => n.id === 'sc-test');
  assert.equal(after.height, 'standard', '480 应落在 standard 档');
  assert.ok(repairs.some((r) => r.action === 'map-to-enum' && r.path.endsWith('.height')));
});

test('scene3d.controls 数组转布尔对象，rotate 映射为 orbit 而不是自动旋转', () => {
  const plan = base();
  const section = plan.nodes.find((n) => n.type === 'section');
  section.children.push({
    id: 'sc-ctl', type: 'scene3d', label: '场景', description: '',
    height: 'compact', background: '#101018', cameraDistance: 20,
    controls: ['rotate', 'zoom'],
    objects: [{
      id: 'rock-2', name: '岩石', shape: 'rock',
      position: [0, 0, 0], scale: [1, 1, 1], rotation: [0, 0, 0],
      color: '#334455', material: 'stone', description: '', selectable: false, motion: 'none',
    }],
  });

  const { draft } = norm(plan);
  const after = findNode(draft.nodes, (n) => n.id === 'sc-ctl');
  assert.equal(after.controls.orbit, true);
  assert.equal(after.controls.zoom, true);
  assert.equal(after.controls.autoRotate, false, 'rotate 不得被误解成自动旋转');
  assert.equal(after.controls.dayNight, false);
});

test('scene3d 对象缺 name 时用 id 派生，不发明新文案', () => {
  const plan = base();
  const section = plan.nodes.find((n) => n.type === 'section');
  section.children.push({
    id: 'sc-name', type: 'scene3d', label: '场景', description: '',
    height: 'compact', background: '#101018', cameraDistance: 20,
    controls: { orbit: true, zoom: false, autoRotate: false, dayNight: false, tide: false },
    objects: [{
      id: 'main-dome', shape: 'dome',
      position: [0, 0, 0], scale: [1, 1, 1], rotation: [0, 0, 0],
      color: '#334455', material: 'stone', description: '', selectable: false, motion: 'none',
    }],
  });

  const { draft, repairs } = norm(plan);
  const after = findNode(draft.nodes, (n) => n.id === 'sc-name');
  assert.equal(after.objects[0].name, 'Main Dome');
  assert.ok(repairs.some((r) => r.action === 'derive-from-id'));
  assert.doesNotThrow(() => validatePagePlan(draft));
});

test('scene3d 的 tide 只允许在 disk 上，其他形状被改回 none', () => {
  const plan = base();
  const section = plan.nodes.find((n) => n.type === 'section');
  section.children.push({
    id: 'sc-tide', type: 'scene3d', label: '场景', description: '',
    height: 'compact', background: '#101018', cameraDistance: 20,
    controls: { orbit: true, zoom: false, autoRotate: false, dayNight: false, tide: false },
    objects: [{
      id: 'rock-3', name: '岩石', shape: 'rock',
      position: [0, 0, 0], scale: [1, 1, 1], rotation: [0, 0, 0],
      color: '#334455', material: 'stone', description: '', selectable: false, motion: 'tide',
    }],
  });

  const { draft } = norm(plan);
  const after = findNode(draft.nodes, (n) => n.id === 'sc-tide');
  assert.equal(after.objects[0].motion, 'none');
  assert.doesNotThrow(() => validatePagePlan(draft));
});

test('scene3d 的非法形状不会被"修成"合法形状，仍被校验拒绝', () => {
  const plan = base();
  const section = plan.nodes.find((n) => n.type === 'section');
  section.children.push({
    id: 'sc-bad', type: 'scene3d', label: '场景', description: '',
    height: 'compact', background: '#101018', cameraDistance: 20,
    controls: { orbit: true, zoom: false, autoRotate: false, dayNight: false, tide: false },
    objects: [{
      id: 'weird', name: '怪东西', shape: 'spaceship',
      position: [0, 0, 0], scale: [1, 1, 1], rotation: [0, 0, 0],
      color: '#334455', material: 'stone', description: '', selectable: false, motion: 'none',
    }],
  });

  const { draft } = norm(plan);
  const after = findNode(draft.nodes, (n) => n.id === 'sc-bad');
  assert.equal(after.objects[0].shape, 'spaceship', '不得擅自替换形状');
  assert.throws(() => validatePagePlan(draft), /shape/);
});
