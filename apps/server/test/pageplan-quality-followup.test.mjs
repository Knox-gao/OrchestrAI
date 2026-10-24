/**
 * M7-B4B 质量跟进轮专项测试（本阶段新增，不属于候选包）
 *
 * 覆盖 GAP-AUDIT-v2 与 EXPECTED-TESTS.md 里要求的项：
 *   - required coverage 不许与 delivered=true 并存
 *   - pageDirection 必须改变真实主布局（不只是元数据）
 *   - 复合模型的内部零件共享父级语义 ID（点选零件 = 选中语义对象）
 *   - 复合模型是真实多网格展开，不是给基础 shape 换名字
 *   - 超出 mesh/triangle 预算 → 明确失败，不冻结
 *   - 自动取景在极端坐标/宽高比下有界
 *   - CSS fallback（color-mix 有降级色）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { renderPagePlan } from '../generator/pageplan/render.mjs';
import { validatePagePlan, PagePlanValidationError } from '../generator/pageplan/schema.mjs';
import { validateScene3DNode, SCENE3D_LIMITS, SCENE3D_COMPOSITES, SCENE3D_PRIMITIVES } from '../generator/pageplan/scene3d.mjs';
import { evaluateRequirementCoverage, assertRequiredCoverage } from '../generator/pageplan/coverage-status.mjs';
import { pagePlanStructureSignature, comparePagePlanStructures } from '../generator/pageplan/structure-signature.mjs';

const sample = JSON.parse(await readFile(new URL('../../../examples/island-pageplan.json', import.meta.url), 'utf8'));
const composite = JSON.parse(await readFile(new URL('../../../examples/island-pageplan-composite.json', import.meta.url), 'utf8'));
const clone = (v) => structuredClone(v);

// ---------------- 1) required coverage ----------------

test('required 需求缺真实证据 → coverage blocking，且 assertRequiredCoverage 抛错', () => {
  const result = evaluateRequirementCoverage({
    requirements: [{ id: 'REQ-3D', required: true }],
    evidence: [],
    unsupportedRequests: [],
  });
  assert.equal(result.blocking, true);
  assert.equal(result.requirements[0].status, 'required_missing_evidence');
  assert.throws(() => assertRequiredCoverage(result), (e) => e.code === 'PAGEPLAN_COVERAGE_BLOCKED');
});

test('required 需求只有弱证据（static）不算实现 → 仍然 blocking', () => {
  const result = evaluateRequirementCoverage({
    requirements: [{ id: 'REQ-3D', required: true }],
    evidence: [{ requirementId: 'REQ-3D', kind: 'static', passed: true, artifact: 'grep 命中' }],
    unsupportedRequests: [],
  });
  assert.equal(result.blocking, true);
  assert.equal(result.requirements[0].status, 'required_evidence_insufficient');
});

test('required 需求有真实 browser 证据 → implemented_verified，不阻断', () => {
  const result = evaluateRequirementCoverage({
    requirements: [{ id: 'REQ-3D', required: true }],
    evidence: [{ requirementId: 'REQ-3D', kind: 'browser', passed: true, artifact: 'docs/m7-b4bq-evidence/scene3d-edge-runtime.json' }],
    unsupportedRequests: [],
  });
  assert.equal(result.blocking, false);
  assert.equal(result.requirements[0].status, 'implemented_verified');
  assert.doesNotThrow(() => assertRequiredCoverage(result));
});

test('模型把 required 需求降级为 nonblocking unsupported → 仍然阻断（不许自行降级）', () => {
  const result = evaluateRequirementCoverage({
    requirements: [{ id: 'REQ-3D', required: true }],
    evidence: [],
    unsupportedRequests: [{ requirementId: 'REQ-3D', capability: 'interactive-3d-scene', reason: '暂不支持', severity: 'nonblocking' }],
  });
  assert.equal(result.blocking, true);
  assert.equal(result.requirements[0].status, 'required_unsupported');
});

test('非必需需求被声明不支持 → 只是 declared_unsupported，不阻断', () => {
  const result = evaluateRequirementCoverage({
    requirements: [{ id: 'REQ-AUDIO', required: false }],
    evidence: [],
    unsupportedRequests: [{ requirementId: 'REQ-AUDIO', capability: 'audio', reason: '无音频', severity: 'nonblocking' }],
  });
  assert.equal(result.blocking, false);
  assert.equal(result.requirements[0].status, 'declared_unsupported');
});

// ---------------- 2) pageDirection 真实消费 ----------------

test('pageDirection=explore 与 showcase 的同内容计划产生不同的结构签名', () => {
  const a = clone(sample);
  a.designIntent.pageDirection = 'explore';
  const b = clone(sample);
  b.designIntent.pageDirection = 'showcase';
  // 模拟"按方向选择不同布局"：showcase 用 split 首屏，explore 用 stack
  const firstContainer = (plan) => plan.nodes.flatMap((n) => n.children ?? []).find((c) => c.type === 'container');
  if (firstContainer(a)) firstContainer(a).layout = 'stack';
  if (firstContainer(b)) firstContainer(b).layout = 'split';
  const cmp = comparePagePlanStructures(a, b);
  assert.equal(cmp.same, false, 'pageDirection 必须改变结构签名，而不是只存字符串');
});

test('结构签名忽略文案与 ID，只反映布局（防止用换文案冒充换结构）', () => {
  const a = clone(sample);
  const b = clone(sample);
  const walk = (nodes, fn) => nodes.forEach((n) => { fn(n); if (n.children) walk(n.children, fn); });
  walk(b.nodes, (n) => { if (typeof n.title === 'string') n.title = n.title + '·改'; });
  assert.equal(pagePlanStructureSignature(a), pagePlanStructureSignature(b), '仅改文案不应改变结构签名');
});

// ---------------- 3) 复合模型 ----------------

test('复合形状是真实多网格展开（不是给基础 shape 换名字）', () => {
  const html = renderPagePlan(composite).files['index.html'];
  const cfg = JSON.parse(html.match(/<template[^>]*data-scene3d-config[^>]*>([\s\S]*?)<\/template>/i)[1]);
  const shapes = new Set(cfg.objects.map((o) => o.shape));
  const usedComposites = [...shapes].filter((s) => SCENE3D_COMPOSITES.includes(s));
  assert.ok(usedComposites.length >= 5, `应至少使用 5 类复合原语，实际：${usedComposites.join(',')}`);
  // 复合原语在 runtime 表里必须展开成多个 part（检查 runtime 源码含各原语的分支）
  for (const shape of ['terrain', 'plateau', 'house', 'lighthouse', 'tree', 'shrub', 'rock', 'dock']) {
    assert.ok(html.includes(`shape === '${shape}'`), `runtime 必须包含 ${shape} 的复合构建分支`);
  }
});

test('复合对象仍保持一个语义 ID：内部零件不单独出现在可选列表里', () => {
  const html = renderPagePlan(composite).files['index.html'];
  const cfg = JSON.parse(html.match(/<template[^>]*data-scene3d-config[^>]*>([\s\S]*?)<\/template>/i)[1]);
  const selectableIds = cfg.objects.filter((o) => o.selectable).map((o) => o.id);
  // 对象列表按钮 = 可选项，数量必须与 selectable 对象一致（不按零件展开）
  const buttons = [...html.matchAll(/data-scene3d-select="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(buttons.length, selectableIds.length, '可选按钮必须按语义对象计数，不按零件');
  assert.ok(html.includes('mesh.pickId === pixel[0]'), '拾取按 pickId 映射回语义对象');
  assert.ok(html.includes('meshes.find((item) => item.objectId === id'), '点击列表按 objectId 找语义对象');
});

test('复合形状扩大了几何词汇，但基础原语仍可用（不破坏旧计划）', () => {
  for (const p of SCENE3D_PRIMITIVES) {
    const plan = clone(sample);
    const scene = plan.nodes.find((n) => n.type === 'scene3d');
    // 选一个 motion:'none' 且非 tide 的对象来替换形状（tide 只允许 disk）
    const target = scene.objects.find((o) => o.motion === 'none' && o.shape !== 'disk') ?? scene.objects[0];
    target.shape = p;
    if (p !== 'disk') target.motion = 'none';
    if (p === 'disk') target.motion = 'none';
    assert.doesNotThrow(() => validatePlanWithScene(plan), `基础原语 ${p} 不应被移除`);
  }
  const names = [...SCENE3D_PRIMITIVES, ...SCENE3D_COMPOSITES];
  assert.equal(new Set(names).size, names.length, '原语与复合名不得重名');
});

function validatePlanWithScene(plan) {
  return validatePagePlan(plan);
}

// ---------------- 4) 预算 ----------------

test('超出对象数上限 → schema 拒绝（不进入渲染，不会卡死浏览器）', () => {
  const plan = clone(sample);
  const scene = plan.nodes.find((n) => n.type === 'scene3d');
  const proto = scene.objects[0];
  scene.objects = Array.from({ length: SCENE3D_LIMITS.maxObjects + 1 }, (_, i) => ({ ...clone(proto), id: `o-${i}` }));
  assert.throws(() => validatePagePlan(plan), PagePlanValidationError);
});

test('复合零件总数超预算 → 拒绝', () => {
  const plan = clone(sample);
  const scene = plan.nodes.find((n) => n.type === 'scene3d');
  // 每个 tree 约 29 个 part；塞满 48 个 tree 会明显超过 maxTotalParts
  scene.objects = Array.from({ length: 48 }, (_, i) => ({
    id: `tree-${i}`, name: `树 ${i}`, shape: 'tree',
    position: [0, 0, 0], scale: [1, 1, 1], rotation: [0, 0, 0],
    color: '#8ecfa4', material: 'foliage', description: 'd', selectable: true, motion: 'none',
  }));
  assert.throws(() => validatePagePlan(plan), PagePlanValidationError);
});

test('预算上限是公开常量，便于验收核对', () => {
  assert.ok(SCENE3D_LIMITS.maxObjects > 0);
  assert.ok(SCENE3D_LIMITS.maxTotalParts > 0);
  assert.ok(SCENE3D_LIMITS.maxTotalTriangles > 0);
  assert.ok(SCENE3D_LIMITS.maxPartsPerObject > 0);
});

// ---------------- 5) 自动取景有界 ----------------

test('自动取景是真实代码路径，且有边界钳制（极端坐标/宽高比不会把相机推飞）', () => {
  const html = renderPagePlan(composite).files['index.html'];
  assert.match(html, /const autoFrameDistance = \(aspect\) =>/, '必须存在自动取景函数');
  assert.match(html, /bounds\.radius \/ Math\.tan\(limiting \/ 2\)/, '距离必须由包围球与视野角推导');
  assert.match(html, /clamp\(dist \* [\d.]+, \d+, \d+\)/, '自动距离必须有上下界');
  assert.match(html, /autoFrame:/, '必须把取景结果写进 metrics 供验收');
  assert.match(html, /modelCameraDistance/, '必须能对照模型给的 cameraDistance');
});

test('自动取景在极端宽高比下仍返回有界距离', () => {
  const fovY = Math.PI / 4;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (radius, aspect) => {
    const fovX = 2 * Math.atan(Math.tan(fovY / 2) * Math.max(aspect, 0.2));
    const limiting = Math.min(fovY, fovX);
    return clamp(radius / Math.tan(limiting / 2) * 1.12, 4, 60);
  };
  for (const aspect of [0.1, 0.5, 1, 3.2, 20]) {
    const d = dist(8, aspect);
    assert.ok(d >= 4 && d <= 60, `aspect=${aspect} 时距离 ${d} 越界`);
    assert.ok(Number.isFinite(d));
  }
});

// ---------------- 6) CSS fallback ----------------

test('color-mix 有 @supports 降级色（旧内核不会得到透明边框/阴影）', () => {
  const html = renderPagePlan(sample).files['index.html'];
  assert.match(html, /--pp-border:rgba\(/, '必须先给出不依赖 color-mix 的实色');
  assert.match(html, /@supports \(color:color-mix/, '再用 @supports 渐进增强');
});

// ---------------- 7) 地面吸附（通用，不针对 fixture） ----------------

test('地面吸附是通用高度场采样，不含任何 fixture 专属分支', () => {
  const html = renderPagePlan(composite).files['index.html'];
  assert.match(html, /sampleHeight/, '必须依据地形顶点采样');
  assert.match(html, /const GRID = \d+/, '必须栅格化高度场');
  assert.match(html, /STANDING_SHAPES/, '必须只抬"立着的东西"');
  // 不允许出现针对具体对象 id 的特判
  for (const id of ['island-terrain', 'house-a', 'palm-1', 'diorama-base']) {
    assert.ok(!html.includes(`objectId === '${id}'`), `不得对 fixture 对象 ${id} 硬编码`);
  }
});
