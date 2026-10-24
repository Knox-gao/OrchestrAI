/**
 * M7-B4D 任务 C：质量指标误报/漏报审计（合成正反例）
 *
 * 每个指标都给出「应报」与「不应报」的正反例。
 * 审计结论（含修正）写在本文件注释与 REPORT-M7-B4D 中。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSceneGeometry, checkSceneRendering, summariseSceneReview } from '../generator/pageplan/scene-review.mjs';

const scene = (...objects) => ({ type: 'scene3d', objects });
const codes = (r) => r.findings.map((f) => f.code);
const has = (r, code) => codes(r).includes(code);
const ground = (over = {}) => ({ id: 'g', shape: 'terrain', position: [0, 0, 0], scale: [20, 1, 20], material: 'stone', color: '#888888', selectable: false, ...over });
const house = (id, pos, extra = {}) => ({ id, shape: 'house', position: pos, scale: [1, 1, 1], material: 'jelly', color: '#f6a8ce', selectable: true, ...extra });

// ================= C1: OBJECTS_FLOATING / OBJECTS_BURIED =================

test('C1 反例：山脚的房子不应被判"半埋"（旧实现用全局最高地表 → 真实误报）', () => {
  // 山高 y=1.0；房子在山脚，顶 y=0.55 —— 合法，但旧逻辑认为 < 1.0-0.08 就是半埋
  const r = checkSceneGeometry(scene(
    ground({ id: 'hill', position: [0, 0.5, 0], scale: [10, 1, 10] }),
    house('house-at-foot', [4, 0.05, 4]),
    { id: 'rock-1', shape: 'rock', position: [3, 0.2, 0], scale: [0.6, 0.5, 0.6], material: 'stone', color: '#c9a3b8', selectable: false },
  ), null);
  assert.equal(has(r, 'OBJECTS_BURIED'), false, `山脚物件不应被判半埋：${JSON.stringify(r.findings)}`);
});

test('C1 正例：真的悬空必须检出', () => {
  const r = checkSceneGeometry(scene(ground(), house('sky-house', [0, 4, 0])), null);
  assert.equal(has(r, 'OBJECTS_FLOATING'), true);
});

test('C1 正例：真的整体埋在地面之下必须检出', () => {
  const r = checkSceneGeometry(scene(ground(), house('buried-house', [0, -3, 0])), null);
  assert.equal(has(r, 'OBJECTS_BURIED'), true);
});

test('C1 判据是本地地表而非世界 y=0：地面抬高后物件居中不报', () => {
  // 地面从 y=5 到 y=7（顶面 7）；物件中心 7、高 1 → 底 6.5，仍在地面范围内
  const r = checkSceneGeometry(scene(
    ground({ position: [0, 6, 0], scale: [20, 2, 20] }),
    house('on-top', [0, 7.2, 0]),
  ), null);
  assert.equal(has(r, 'OBJECTS_BURIED'), false);
  assert.equal(has(r, 'OBJECTS_FLOATING'), false);
});

// ================= C2: OBJECTS_OVERLAP =================

test('C2 反例：两根平行细长栈桥不应被判重叠（旧实现用最大尺寸 → 真实误报）', () => {
  const r = checkSceneGeometry(scene(
    ground(),
    { id: 'dock-a', shape: 'dock', position: [-2, 0.2, 0], scale: [10, 0.5, 0.5], material: 'wood', color: '#b98a77', selectable: true },
    { id: 'dock-b', shape: 'dock', position: [-2, 0.2, 1], scale: [10, 0.5, 0.5], material: 'wood', color: '#b98a77', selectable: true },
  ), null);
  assert.equal(has(r, 'OBJECTS_OVERLAP'), false, `平行栈桥不应报重叠：${JSON.stringify(r.findings)}`);
});

test('C2 正例：两个大房子几乎同位置必须检出重叠', () => {
  const r = checkSceneGeometry(scene(
    ground(),
    house('h1', [0, 1, 0], { scale: [4, 4, 4] }),
    house('h2', [0.5, 1, 0], { scale: [4, 4, 4], material: 'wood', color: '#b98a77' }),
  ), null);
  assert.equal(has(r, 'OBJECTS_OVERLAP'), true);
});

test('C2 反例：两个正常分开的房子不应报重叠', () => {
  const r = checkSceneGeometry(scene(
    ground(),
    house('h1', [-3, 1, 0], { scale: [2, 2, 2] }),
    house('h2', [3, 1, 0], { scale: [2, 2, 2], material: 'wood', color: '#b98a77' }),
  ), null);
  assert.equal(has(r, 'OBJECTS_OVERLAP'), false);
});

test('C2 正例：小物件嵌在大物件内部（真包含）必须检出', () => {
  const r = checkSceneGeometry(scene(
    ground(),
    house('big', [0, 1, 0], { scale: [6, 4, 6] }),
    { id: 'small', shape: 'rock', position: [0.2, 1, 0.2], scale: [0.5, 0.5, 0.5], material: 'stone', color: '#c9a3b8', selectable: false },
  ), null);
  assert.equal(has(r, 'OBJECTS_OVERLAP'), true);
});

// ================= C3: SUBJECT_NOT_DOMINANT =================

test('C3 反例：主体明显大于所有道具时不应告警（旧实现把地形算进中位数 → 真实误报）', () => {
  const r = checkSceneGeometry(scene(
    ground(),                                              // 20 宽的地形：不是"视觉竞争者"
    { id: 'subj', shape: 'terrain', position: [0, 0.5, 0], scale: [6, 2, 6], material: 'jelly', color: '#f6a8ce', selectable: true },
    { id: 'accent', shape: 'rock', position: [0, 1, 3], scale: [0.4, 0.3, 0.4], material: 'stone', color: '#c9a3b8', selectable: false },
  ), { subject: { id: 'subj' } });
  assert.equal(has(r, 'SUBJECT_NOT_DOMINANT'), false, `主体远大于道具不应告警：${JSON.stringify(r.findings)}`);
});

test('C3 正例：主体与配角尺寸相近时应告警', () => {
  const r = checkSceneGeometry(scene(
    ground(),
    house('subj', [0, 1, 0], { scale: [1, 1, 1] }),
    house('other', [3, 1, 0], { scale: [1.2, 1.2, 1.2], material: 'wood', color: '#b98a77' }),
  ), { subject: { id: 'subj' } });
  assert.equal(has(r, 'SUBJECT_NOT_DOMINANT'), true);
});

// ================= C4: NO_DEPTH_LAYERS / FLAT_LAYOUT =================

test('C4 正例：所有物件排成一行（z 无分布）应报 FLAT_LAYOUT', () => {
  const r = checkSceneGeometry(scene(
    ground(),
    house('a', [-3, 1, 0]),
    house('b', [0, 1, 0]),
    { id: 'c', shape: 'tree', position: [3, 1, 0.02], scale: [1, 1, 1], material: 'foliage', color: '#8ecfa4', selectable: true },
    { id: 'd', shape: 'shrub', position: [1.5, 1, 0.04], scale: [1, 1, 1], material: 'foliage', color: '#9bd3b8', selectable: false },
  ), null);
  assert.equal(has(r, 'FLAT_LAYOUT'), true);
});

test('C4 反例：正常 isometric 布局（有 z 分布）不应报 FLAT_LAYOUT', () => {
  const r = checkSceneGeometry(scene(
    ground(),
    house('a', [-3, 1, -2]),
    house('b', [0, 1, 0]),
    { id: 'c', shape: 'tree', position: [3, 1, 2], scale: [1, 1, 1], material: 'foliage', color: '#8ecfa4', selectable: true },
    { id: 'd', shape: 'shrub', position: [1.5, 1, -1], scale: [1, 1, 1], material: 'foliage', color: '#9bd3b8', selectable: false },
  ), null);
  assert.equal(has(r, 'FLAT_LAYOUT'), false);
});

test('C4 brief 层次 <2 → NO_DEPTH_LAYERS 阻断', () => {
  const brief = { objects: [{ id: 'a', layer: 'midground' }, { id: 'b', layer: 'midground' }] };
  const r = checkSceneGeometry(scene(ground(), house('a', [0, 1, 0]), house('b', [3, 1, 0])), brief);
  assert.equal(has(r, 'NO_DEPTH_LAYERS'), true);
});

// ================= C5: OVEREXPOSED / TOO_DARK =================

const render = (o) => checkSceneRendering({ status: 'ready', glError: 0, canvas: { width: 800, height: 600 }, meshes: 5, ...o });

test('C5 正例：白 40% → OVEREXPOSED（blocking）', () => {
  const r = render({ whiteRatio: 0.40 });
  assert.equal(has(r, 'OVEREXPOSED'), true);
  assert.equal(r.findings.find((f) => f.code === 'OVEREXPOSED').severity, 'blocking');
});

test('C5 边界：白 30% → HOT_HIGHLIGHTS（warning，不阻断）', () => {
  const r = render({ whiteRatio: 0.30 });
  assert.equal(has(r, 'OVEREXPOSED'), false);
  assert.equal(has(r, 'HOT_HIGHLIGHTS'), true);
});

test('C5 反例：白 5%（正常浅色背景）不报', () => {
  const r = render({ whiteRatio: 0.05 });
  assert.equal(has(r, 'OVEREXPOSED'), false);
  assert.equal(has(r, 'HOT_HIGHLIGHTS'), false);
});

test('C5 正例：黑 60% → TOO_DARK（warning）', () => {
  const r = render({ blackRatio: 0.60, whiteRatio: 0.01 });
  assert.equal(has(r, 'TOO_DARK'), true);
});

test('C5 防护：status=error 时不应只看黑占比（先报 SCENE_NOT_READY）', () => {
  const r = render({ blackRatio: 0.6, status: 'error' });
  assert.equal(has(r, 'SCENE_NOT_READY'), true);
  assert.equal(r.findings.find((f) => f.code === 'SCENE_NOT_READY').severity, 'blocking');
});

// ================= C6: MATERIAL_MONOTONE =================

test('C6 正例：全场景同一材质 → 单调阻断（材质名映射到不同 gloss 档位）', () => {
  const r = checkSceneGeometry(scene(
    { id: 'a', shape: 'sphere', position: [-2, 1, 0], scale: [1, 1, 1], material: 'jelly', color: '#f00', selectable: true },
    { id: 'b', shape: 'sphere', position: [0, 1, 0], scale: [1, 1, 1], material: 'jelly', color: '#0f0', selectable: true },
    { id: 'c', shape: 'sphere', position: [2, 1, 0], scale: [1, 1, 1], material: 'jelly', color: '#00f', selectable: true },
  ), null);
  assert.equal(has(r, 'MATERIAL_MONOTONE'), true);
  // 颜色差异仍被记录为独立信号，但不推翻"材质单调"判定
  assert.equal(r.metrics.materialSurfaces, 3);
});

test('C6 反例：三种不同材质 → 不阻断', () => {
  const r = checkSceneGeometry(scene(
    { id: 'a', shape: 'sphere', position: [-2, 1, 0], scale: [1, 1, 1], material: 'jelly', color: '#f00', selectable: true },
    { id: 'b', shape: 'sphere', position: [0, 1, 0], scale: [1, 1, 1], material: 'matte', color: '#0f0', selectable: true },
    { id: 'c', shape: 'sphere', position: [2, 1, 0], scale: [1, 1, 1], material: 'metal', color: '#00f', selectable: true },
  ), null);
  assert.equal(has(r, 'MATERIAL_MONOTONE'), false);
});

// ================= C7: NO_COMPOSITE_SHAPES =================

test('C7 正例：全是基础几何 → 报 NO_COMPOSITE_SHAPES（warning，不阻断）', () => {
  // 注意：terrain/plateau/lagoon 本身就是复合原语，因此这里刻意不放地面，
  // 才能构造"纯 primitive 场景"。
  const sceneNoGround = scene(
    { id: 'a', shape: 'sphere', position: [0, 1, 0], scale: [1, 1, 1], material: 'jelly', color: '#f00', selectable: true },
    { id: 'b', shape: 'box', position: [2, 1, 0], scale: [1, 1, 1], material: 'matte', color: '#0f0', selectable: true },
    { id: 'c', shape: 'cylinder', position: [4, 1, 0], scale: [1, 1, 1], material: 'metal', color: '#00f', selectable: true },
  );
  const r = checkSceneGeometry(sceneNoGround, null);
  const f = r.findings.find((x) => x.code === 'NO_COMPOSITE_SHAPES');
  assert.ok(f);
  assert.equal(f.severity, 'warning', '极简场景不应因此阻断');
});

test('C7 反例：使用复合原语 → 不报', () => {
  const r = checkSceneGeometry(scene(
    ground(),
    house('h', [0, 1, 0]),
    { id: 't', shape: 'tree', position: [2, 1, 0], scale: [1, 1, 1], material: 'foliage', color: '#8ecfa4', selectable: true },
  ), null);
  assert.equal(has(r, 'NO_COMPOSITE_SHAPES'), false);
});

// ================= C8: 主体裁切 / 留白 / 焦点 是否被混为一谈 =================

test('C8 主体裁切只由渲染侧 subjectCoverage 判定，几何层不得输出裁切结论', () => {
  // 几何层没有相机信息，因此它**不能**判断裁切。
  // 这里断言几何层 findings 里不存在任何"裁切/构图"类代码，避免职责混同。
  const r = checkSceneGeometry(scene(ground(), house('h', [0, 1, 0])), { subject: { id: 'h' } });
  const forbidden = codes(r).filter((c) => /CLIP|CROP|FRAMING|WHITESPACE|FOCAL/i.test(c));
  assert.deepEqual(forbidden, [], `几何层不应产出裁切/构图结论：${forbidden.join(',')}`);
});

test('C8 自动检查不能宣称艺术质量（note 必须声明）', () => {
  const s = summariseSceneReview({ geometry: { findings: [] }, rendering: null });
  assert.match(s.note, /人工|美术/);
});

// ================= 汇总层 =================

test('汇总层：任一 blocking → ok=false', () => {
  const s = summariseSceneReview({
    geometry: { findings: [{ code: 'X', severity: 'blocking', detail: 'x' }] },
    rendering: { findings: [] },
  });
  assert.equal(s.ok, false);
  assert.equal(s.blockingCount, 1);
});

test('汇总层：只有 warning → ok=true（warning 不阻断交付）', () => {
  const s = summariseSceneReview({
    geometry: { findings: [{ code: 'Y', severity: 'warning', detail: 'y' }] },
    rendering: { findings: [] },
  });
  assert.equal(s.ok, true);
  assert.equal(s.warningCount, 1);
});
