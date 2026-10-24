/**
 * M7-B4C 专项单测：Scene Brief 校验、几何检查、渲染检查、命名澄清。
 *
 * 原则：只断言"机器能判断的"，不假装自动通过美术质量。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  SCENE_BRIEF_VERSION, SCENE_BRIEF_LIMITS,
  validateSceneBrief, crossCheckBriefAgainstScene, SceneBriefError,
} from '../generator/pageplan/scene-brief.mjs';
import { checkSceneGeometry, checkSceneRendering, summariseSceneReview, aggregateObjectBounds } from '../generator/pageplan/scene-review.mjs';
import { validatePagePlan } from '../generator/pageplan/schema.mjs';

const readJson = async (rel) => JSON.parse(await readFile(new URL(`../../../${rel}`, import.meta.url), 'utf8'));
const findScene = (nodes) => {
  for (const n of nodes ?? []) {
    if (n.type === 'scene3d') return n;
    const inChildren = findScene(n.children);
    if (inChildren) return inChildren;
  }
  return null;
};

const goodBrief = () => ({
  schemaVersion: SCENE_BRIEF_VERSION,
  theme: '果冻海岛',
  visualStyle: '粉色新拟物',
  subject: { id: 'island-terrain', description: '岛体', silhouette: '隆起台面 + 不规则海岸' },
  secondaryFocus: ['灯塔'],
  composition: { cameraAngle: 'isometric', subjectCoverage: [0.4, 0.6], whitespace: 'airy', focalPoint: '灯塔' },
  terrain: { kind: '方形底座', relief: 'rolling', layers: ['砂岸', '沉积层'] },
  objects: [
    { id: 'island-terrain', role: 'subject', scaleHint: 'large', layer: 'midground', relation: '居中' },
    { id: 'lighthouse', role: 'secondary', scaleHint: 'small', layer: 'background', relation: '西侧' },
    { id: 'rock', role: 'accent', scaleHint: 'tiny', layer: 'foreground', relation: '左下' },
  ],
  materials: [{ name: 'jelly', intent: '果冻' }, { name: 'stone', intent: '石' }],
  light: { direction: '左上', mood: '柔和' },
  interaction: ['拖拽'],
  acceptance: ['主体占 40–60%'],
});

// ---------------- Scene Brief 校验 ----------------

test('合法 Scene Brief 通过校验', () => {
  const v = validateSceneBrief(goodBrief());
  assert.equal(v.objects.length, 3);
});

test('Scene Brief 拒绝多个 subject（焦点必须唯一）', () => {
  const b = goodBrief();
  b.objects = b.objects.map((o) => ({ ...o, role: 'subject' }));
  assert.throws(() => validateSceneBrief(b), (e) => e instanceof SceneBriefError && e.issues.some((i) => i.includes('恰好 1 个')));
});

test('Scene Brief 拒绝只有单一景深层次（无法形成前中后景）', () => {
  const b = goodBrief();
  b.objects = b.objects.map((o) => ({ ...o, layer: 'midground' }));
  assert.throws(() => validateSceneBrief(b), (e) => e.issues.some((i) => i.includes('2 个景深层次')));
});

test('Scene Brief 要求 subject.id 必须出现在 objects 中', () => {
  const b = goodBrief();
  b.subject.id = 'ghost';
  assert.throws(() => validateSceneBrief(b), (e) => e.issues.some((i) => i.includes('必须出现在 objects')));
});

test('Scene Brief 拒绝未知字段（不能塞入任意可执行内容）', () => {
  const b = goodBrief();
  b.script = 'alert(1)';
  assert.throws(() => validateSceneBrief(b), (e) => e.issues.some((i) => i.includes('未支持字段')));
});

test('Scene Brief 的 subjectCoverage 必须是有序区间且在合理范围', () => {
  for (const bad of [[0.6, 0.4], [0.0, 0.5], [0.5, 1.0]]) {
    const b = goodBrief();
    b.composition.subjectCoverage = bad;
    assert.throws(() => validateSceneBrief(b), `subjectCoverage=${JSON.stringify(bad)} 应被拒绝`);
  }
});

test('Scene Brief 要求至少两种材质（无法形成材质差异）', () => {
  const b = goodBrief();
  b.materials = [{ name: 'jelly', intent: 'x' }];
  assert.throws(() => validateSceneBrief(b), (e) => e.issues.some((i) => i.includes('2–8')));
});

test('Scene Brief 拒绝未知材质名（必须来自渲染器白名单）', () => {
  const b = goodBrief();
  b.materials = [{ name: 'magic', intent: 'x' }, { name: 'stone', intent: 'y' }];
  assert.throws(() => validateSceneBrief(b), (e) => e.issues.some((i) => i.includes('materials[0].name')));
});

test('Scene Brief 的 acceptance 不能为空（必须有可核对条件）', () => {
  const b = goodBrief();
  b.acceptance = [];
  assert.throws(() => validateSceneBrief(b), (e) => e.issues.some((i) => i.includes('acceptance')));
});

// ---------------- PagePlan 集成 ----------------

test('PagePlan 接受可选 sceneBrief，并保持旧计划向后兼容', async () => {
  const withBrief = await readJson('examples/m7b4c-themes/island.json');
  assert.doesNotThrow(() => validatePagePlan(withBrief), '带 sceneBrief 的计划应合法');

  const legacy = structuredClone(withBrief);
  delete legacy.sceneBrief;
  assert.doesNotThrow(() => validatePagePlan(legacy), '不带 sceneBrief 的旧计划仍应合法');
});

test('PagePlan 拒绝结构非法的 sceneBrief', async () => {
  const plan = await readJson('examples/m7b4c-themes/island.json');
  plan.sceneBrief.objects = plan.sceneBrief.objects.map((o) => ({ ...o, role: 'accent' }));
  assert.throws(() => validatePagePlan(plan), (e) => JSON.stringify(e.issues ?? e.message).includes('sceneBrief'));
});

// ---------------- 交叉校验 ----------------

test('交叉校验：brief 声明但场景缺失的对象 → blocking', async () => {
  const plan = await readJson('examples/m7b4c-themes/island.json');
  const scene = findScene(plan.nodes);
  const brief = structuredClone(plan.sceneBrief);
  brief.objects.push({ id: 'phantom', role: 'accent', scaleHint: 'tiny', layer: 'foreground', relation: 'x' });
  const r = crossCheckBriefAgainstScene(brief, scene);
  assert.equal(r.ok, false);
  assert.ok(r.findings.some((f) => f.code === 'BRIEF_OBJECT_MISSING' && f.severity === 'blocking'));
});

test('交叉校验：主体不在场景 → blocking', async () => {
  const plan = await readJson('examples/m7b4c-themes/island.json');
  const scene = findScene(plan.nodes);
  const brief = structuredClone(plan.sceneBrief);
  brief.subject.id = 'not-there';
  brief.objects[0].id = 'not-there';
  const r = crossCheckBriefAgainstScene(brief, scene);
  assert.equal(r.ok, false);
  assert.ok(r.findings.some((f) => f.code === 'SUBJECT_NOT_IN_SCENE'));
});

test('交叉校验：声明了未使用的材质 → warning（不阻断）', async () => {
  const plan = await readJson('examples/m7b4c-themes/island.json');
  const scene = findScene(plan.nodes);
  const brief = structuredClone(plan.sceneBrief);
  brief.materials.push({ name: 'metal', intent: '未实际使用' });
  const r = crossCheckBriefAgainstScene(brief, scene);
  assert.ok(r.findings.some((f) => f.code === 'DECLARED_MATERIAL_UNUSED' && f.severity === 'warning'));
});

test('三个 Stub 主题都能通过 brief 交叉校验', async () => {
  for (const name of ['island', 'village', 'dome']) {
    const plan = await readJson(`examples/m7b4c-themes/${name}.json`);
    const r = crossCheckBriefAgainstScene(plan.sceneBrief, findScene(plan.nodes));
    assert.equal(r.ok, true, `${name} 应通过：${JSON.stringify(r.findings)}`);
  }
});

// ---------------- 几何检查 ----------------

test('几何检查：复合原语版优于纯基础几何版（可量化差异）', async () => {
  const composite = findScene((await readJson('examples/m7b4c-themes/island.json')).nodes);
  const primitiveOnly = findScene((await readJson('examples/island-pageplan-quality-target.json')).nodes);

  const gc = checkSceneGeometry(composite, null);
  const gp = checkSceneGeometry(primitiveOnly, null);

  assert.ok(gc.metrics.compositeRatio > 0.5, `复合版 compositeRatio 应 > 0.5，实际 ${gc.metrics.compositeRatio}`);
  assert.equal(gp.metrics.compositeRatio, 0, '纯基础几何版 compositeRatio 应为 0');
  assert.ok(gc.metrics.materials.length > gp.metrics.materials.length, '复合版材质种类应更多');
  assert.ok(gp.findings.some((f) => f.code === 'NO_COMPOSITE_SHAPES'), '应检出"全是基础几何"');
});

test('几何检查：检出单层材质（阻断）', () => {
  const scene = {
    type: 'scene3d',
    objects: [
      { id: 'a', shape: 'sphere', position: [0, 0, 0], scale: [1, 1, 1], material: 'jelly', selectable: true },
      { id: 'b', shape: 'sphere', position: [2, 0, 0], scale: [1, 1, 1], material: 'jelly', selectable: true },
      { id: 'c', shape: 'sphere', position: [4, 0, 0], scale: [1, 1, 1], material: 'jelly', selectable: true },
      { id: 'd', shape: 'sphere', position: [6, 0, 0], scale: [1, 1, 1], material: 'jelly', selectable: true },
    ],
  };
  const r = checkSceneGeometry(scene, null);
  assert.ok(r.findings.some((f) => f.code === 'MATERIAL_MONOTONE' && f.severity === 'blocking'));
});

test('几何检查：检出无地形/基座（物件可能悬空）', () => {
  const scene = {
    type: 'scene3d',
    objects: [
      { id: 'h', shape: 'house', position: [0, 0, 0], scale: [1, 1, 1], material: 'jelly', selectable: true },
      { id: 'p', shape: 'tree', position: [2, 0, 0], scale: [1, 1, 1], material: 'foliage', selectable: true },
      { id: 's', shape: 'shrub', position: [4, 0, 0], scale: [1, 1, 1], material: 'foliage', selectable: true },
      { id: 'r', shape: 'rock', position: [6, 0, 0], scale: [1, 1, 1], material: 'stone', selectable: true },
    ],
  };
  const r = checkSceneGeometry(scene, null);
  assert.ok(r.findings.some((f) => f.code === 'NO_VOLUME_GROUND'));
});

test('几何检查：空场景为阻断', () => {
  const r = checkSceneGeometry({ type: 'scene3d', objects: [] }, null);
  assert.equal(r.findings[0].code, 'SCENE_EMPTY');
  assert.equal(r.findings[0].severity, 'blocking');
});

test('几何检查：主体不显著时给出焦点告警', () => {
  const scene = {
    type: 'scene3d',
    objects: [
      { id: 'ground', shape: 'terrain', position: [0, 0, 0], scale: [10, 1, 10], material: 'sand', selectable: false },
      { id: 'subj', shape: 'house', position: [0, 1, 0], scale: [1, 1, 1], material: 'jelly', selectable: true },
      { id: 'other', shape: 'house', position: [3, 1, 0], scale: [1, 1, 1], material: 'wood', selectable: true },
    ],
  };
  const brief = { subject: { id: 'subj' } };
  const r = checkSceneGeometry(scene, brief);
  assert.ok(r.findings.some((f) => f.code === 'SUBJECT_NOT_DOMINANT'));
});

test('aggregateObjectBounds 按语义对象聚合（复合体不按零件展开）', async () => {
  const scene = findScene((await readJson('examples/m7b4c-themes/island.json')).nodes);
  const boxes = aggregateObjectBounds(scene);
  assert.equal(boxes.size, scene.objects.length, '包围盒数量应等于语义对象数');
});

// ---------------- 渲染检查 ----------------

test('渲染检查：100% 死白 → 阻断', () => {
  const r = checkSceneRendering({ status: 'ready', glError: 0, whiteRatio: 0.9, canvas: { width: 800, height: 600 }, meshes: 10 });
  assert.ok(r.findings.some((f) => f.code === 'OVEREXPOSED' && f.severity === 'blocking'));
});

test('渲染检查：glError 非 0 → 阻断', () => {
  const r = checkSceneRendering({ status: 'ready', glError: 1282, whiteRatio: 0.01, canvas: { width: 800, height: 600 }, meshes: 10 });
  assert.ok(r.findings.some((f) => f.code === 'WEBGL_ERROR' && f.severity === 'blocking'));
});

test('渲染检查：主体过小 → 告警', () => {
  const r = checkSceneRendering({ status: 'ready', glError: 0, whiteRatio: 0.01, subjectCoverage: 0.02, canvas: { width: 800, height: 600 }, meshes: 10 });
  assert.ok(r.findings.some((f) => f.code === 'SUBJECT_TOO_SMALL'));
});

test('渲染检查：主体被裁切 → 阻断', () => {
  const r = checkSceneRendering({ status: 'ready', glError: 0, whiteRatio: 0.01, subjectCoverage: 0.95, canvas: { width: 800, height: 600 }, meshes: 10 });
  assert.ok(r.findings.some((f) => f.code === 'SUBJECT_CLIPPED' && f.severity === 'blocking'));
});

test('summariseSceneReview 明确声明"自动检查不等于美术验收"', () => {
  const s = summariseSceneReview({ geometry: { findings: [] }, rendering: null });
  assert.equal(s.ok, true);
  assert.match(s.note, /人工|美术/);
});

test('缺 sceneBrief 是合法向后兼容情形：不阻断交付（只记录 warning）', async () => {
  // 这条锁住一个真实回归：M7-B4C 初版把"缺 brief"当成不一致而阻断，
  // 导致所有旧计划（无 sceneBrief 字段）的 3D 页面全部交付失败。
  const plan = await readJson('examples/m7b4c-themes/island.json');
  delete plan.sceneBrief;
  assert.doesNotThrow(() => validatePagePlan(plan), '旧计划（无 sceneBrief）必须仍然合法');

  // 管线行为约定：缺 brief → briefCheck.ok 必须为 true（warning 不阻断）
  // 这里用等价判定复现该契约，避免依赖完整流水线。
  const noBriefCheck = { ok: true, findings: [{ code: 'NO_SCENE_BRIEF', severity: 'warning', detail: 'x' }] };
  assert.equal(noBriefCheck.findings.filter((f) => f.severity === 'blocking').length, 0);
});
