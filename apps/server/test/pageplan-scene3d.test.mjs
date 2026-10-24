import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import { validatePagePlan, PagePlanValidationError } from '../generator/pageplan/schema.mjs';
import { renderPagePlan } from '../generator/pageplan/render.mjs';
import { validateScene3DNode, SCENE3D_LIMITS, SCENE3D_RUNTIME } from '../generator/pageplan/scene3d.mjs';

const sample = JSON.parse(await readFile(new URL('../../../examples/island-pageplan.json', import.meta.url), 'utf8'));
const clone = (value) => structuredClone(value);
const scene = () => clone(sample.nodes.find((node) => node.type === 'scene3d'));

test('scene3d is a real WebGL scene in standalone HTML with orbit, zoom and scene selection', () => {
  const result = renderPagePlan(sample);
  const html = result.files['index.html'];
  assert.match(html, /getContext\('webgl'/);
  assert.match(html, /uViewProjection/);
  assert.match(html, /gl\.drawArrays\(gl\.TRIANGLES/);
  assert.match(html, /pointermove/);
  assert.match(html, /readPixels\(/, 'object selection uses the WebGL depth buffer rather than only matching object centers');
  assert.doesNotThrow(() => new Script(SCENE3D_RUNTIME), 'embedded browser runtime parses as JavaScript');
  assert.match(html, /data-scene3d-action="reset"/);
  assert.match(html, /data-scene3d-action="auto-rotate"/);
  assert.match(html, /data-scene3d-action="day-night"/);
  assert.match(html, /data-scene3d-tide/);
  assert.match(html, /data-scene3d-select="island-lighthouse"/);
  assert.match(html, /WebGL 三维场景/);
  assert.doesNotMatch(html, /<script[^>]+src=/i, '3D runtime ships inline without external script CDN');
  // report 结构：本仓库在候选基础上加了 cspHash（CSP 精确锁定 runtime）与 autoFrame（自动取景）两项审计字段
  assert.equal(result.report.features.scene3d.scenes, 1);
  assert.equal(result.report.features.scene3d.objects, 14);
  assert.equal(result.report.features.scene3d.renderer, 'WebGL1-local-no-dependencies');
  assert.equal(result.report.features.scene3d.orbitControls, true);
  assert.equal(result.report.features.scene3d.zoomControls, true);
  assert.equal(result.report.features.scene3d.autoFrame, true, '自动取景必须开启');
  assert.match(result.report.features.scene3d.cspHash, /^sha256-/);
  // 自动取景与地面吸附的证据必须在 runtime 里可查（不是只写在报告里）
  assert.match(html, /autoFrameDistance/, 'runtime 必须计算自动取景距离');
  assert.match(html, /sampleHeight/, 'runtime 必须做地形高度采样以吸附物件');
});

test('scene3d configuration rejects unknown shape, arbitrary properties and unbounded values', () => {
  const plan = clone(sample);
  const s = plan.nodes.find((node) => node.type === 'scene3d');
  s.objects[0].shape = 'arbitrary-js';
  assert.equal(validateScene3DNode(s), false);
  assert.throws(() => validatePagePlan(plan), PagePlanValidationError);
  const overflow = scene();
  overflow.objects[0].scale[0] = SCENE3D_LIMITS.scaleMax + 1;
  assert.equal(validateScene3DNode(overflow), false);
  const code = scene();
  code.objects[0].onClick = 'alert(1)';
  assert.equal(validateScene3DNode(code), false);
});

test('scene3d rejects too many objects, invalid IDs and unsupported motion on non-water shapes', () => {
  const a = scene();
  a.objects = Array.from({ length: SCENE3D_LIMITS.maxObjects + 1 }, (_, i) => ({
    id: `obj-${i}`, name: `对象 ${i}`, shape: 'sphere', position: [0, 0, 0], scale: [1, 1, 1], rotation: [0, 0, 0], color: '#ffffff', material: 'jelly', description: '', selectable: true, motion: 'none',
  }));
  assert.equal(validateScene3DNode(a), false);
  const invalidMotion = scene();
  invalidMotion.objects[1].motion = 'tide';
  assert.equal(validateScene3DNode(invalidMotion), false);
});

test('scene3d escapes model-controlled text and JSON cannot terminate its config script', () => {
  const plan = clone(sample);
  const s = plan.nodes.find((node) => node.type === 'scene3d');
  s.label = '</script><script>alert(1)</script>';
  s.objects[0].name = '</script><img src=x onerror=alert(1)>';
  s.objects[0].description = '</script><script>alert(2)</script>';
  const html = renderPagePlan(plan).files['index.html'];
  assert.match(html, /\\u003c\/script\\u003e/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/i);
  assert.doesNotMatch(html, /<img src=x onerror=/i);
  assert.match(html, /data-scene3d-error/);
});

test('scene3d control flags are validated booleans rather than model-provided handlers', () => {
  const plan = clone(sample);
  const s = plan.nodes.find((node) => node.type === 'scene3d');
  s.controls.orbit = 'on';
  assert.throws(() => validatePagePlan(plan), PagePlanValidationError);
  const unknown = clone(sample);
  unknown.nodes.find((node) => node.type === 'scene3d').controls.eval = true;
  assert.throws(() => validatePagePlan(unknown), PagePlanValidationError);
});

test('scene3d runtime initializes and controls issue WebGL draws in a deterministic mock harness', async () => {
  const { runInNewContext } = await import('node:vm');
  const plan = clone(sample);
  const config = plan.nodes.find((node) => node.type === 'scene3d');
  const makeElement = (attributes = {}) => ({
    ...attributes,
    dataset: {},
    hidden: false,
    textContent: '',
    value: attributes.value ?? '',
    attrs: {},
    handlers: {},
    addEventListener(name, fn) { this.handlers[name] = fn; },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return this.attrs[name] ?? this[name === 'data-scene3d-select' ? 'sceneId' : name]; },
  });
  const status = makeElement(), error = makeElement(), selectedName = makeElement(), selectedDescription = makeElement();
  error.hidden = true;
  const selectButtons = config.objects.filter((o) => o.selectable).map((o) => makeElement({ sceneId: o.id }));
  const canvas = makeElement();
  canvas.width = 960; canvas.height = 560; canvas.clientWidth = 960; canvas.clientHeight = 560;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 960, height: 560 });
  canvas.setPointerCapture = () => {};
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5,
    STATIC_DRAW: 6, DYNAMIC_DRAW: 7, FLOAT: 8, TRIANGLES: 9, COLOR_BUFFER_BIT: 10,
    DEPTH_BUFFER_BIT: 11, DEPTH_TEST: 12, LEQUAL: 13, BLEND: 14, DITHER: 15,
    RGBA: 16, UNSIGNED_BYTE: 17, NO_ERROR: 0, drawCount: 0, bufferCount: 0,
    createShader: () => ({}), shaderSource: () => {}, compileShader: () => {}, getShaderParameter: () => true,
    getShaderInfoLog: () => '', createProgram: () => ({}), attachShader: () => {}, linkProgram: () => {}, deleteShader: () => {},
    getProgramParameter: () => true, getProgramInfoLog: () => '', deleteProgram: () => {},
    getAttribLocation: (_p, name) => name === 'aPosition' ? 0 : 1, getUniformLocation: (_p, name) => name,
    createBuffer: () => ({}), bindBuffer: () => {}, bufferData: () => {}, viewport: () => {}, clearColor: () => {}, clear: () => {},
    enable: () => {}, disable: () => {}, depthFunc: () => {}, useProgram: () => {}, uniformMatrix4fv: () => {},
    uniform3fv: () => {}, uniform1f: () => {}, enableVertexAttribArray: () => {}, vertexAttribPointer: () => {},
    uniform4f: () => {}, depthMask: () => {}, blendFunc: () => {}, getExtension: () => null,
    uniform2f: () => {}, uniform3f: () => {}, drawArrays() { this.drawCount += 1; }, readPixels: (_x,_y,_w,_h,_format,_type,pixels) => { pixels.fill(0); }, getError: () => 0,
  };
  canvas.getContext = (name) => name === 'webgl' ? gl : null;
  const resetButton = makeElement(), autoButton = makeElement(), dayButton = makeElement(), tide = makeElement({ value: '0.12' });
  resetButton.getAttribute = () => null;
  const root = makeElement();
  root.querySelector = (selector) => ({
    'template[data-scene3d-config]': { content: { textContent: JSON.stringify(config) } },
    '[data-scene3d-canvas]': canvas,
    '[data-scene3d-status]': status,
    '[data-scene3d-error]': error,
    '[data-scene3d-selected-name]': selectedName,
    '[data-scene3d-selected-description]': selectedDescription,
    '[data-scene3d-action="reset"]': resetButton,
    '[data-scene3d-action="auto-rotate"]': autoButton,
    '[data-scene3d-action="day-night"]': dayButton,
    '[data-scene3d-tide]': tide,
  }[selector] ?? null);
  root.querySelectorAll = (selector) => selector === '[data-scene3d-select]' ? selectButtons : [];
  root.setAttribute = (name, value) => { root.attrs[name] = String(value); if (name === 'data-scene3d-status') root.dataset.scene3dStatus = String(value); };
  const context = {
    document: { querySelectorAll: (selector) => selector === '[data-pageplan-scene3d]' ? [root] : [] },
    window: { devicePixelRatio: 1, matchMedia: () => ({ matches: false }), addEventListener: () => {} },
    ResizeObserver: class { constructor(callback) { this.callback = callback; } observe() {} },
    performance: { now: () => 0 },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    console: { error: () => {}, warn: () => {}, log: () => {} },
  };
  runInNewContext(SCENE3D_RUNTIME, context);
  assert.equal(root.dataset.scene3dStatus, 'ready');
  // 状态文案升级为"对象 / 网格 / 三角形"三元组（复合模型一个对象可含多个 mesh）
  assert.match(status.textContent, /14 个对象 \/ \d+ 个网格 \/ \d+ 三角形/);
  assert.equal(error.hidden, true);
  assert.ok(gl.drawCount > 0, 'WebGL draw calls are issued');
  // 性能与预算指标必须落盘到 DOM（供真实浏览器验收读取），而不是只打日志
  const metrics = JSON.parse(root.attrs['data-scene3d-metrics']);
  assert.equal(metrics.objects, 14);
  assert.ok(metrics.meshes >= 14, '复合模型会展开成多个 mesh');
  assert.ok(metrics.triangles > 0);
  assert.ok(Number.isFinite(metrics.initMs) && metrics.initMs >= 0);
  assert.ok(metrics.budget.maxTotalTriangles > 0, '预算上限必须公开可审计');
  assert.ok(metrics.autoFrame.distance > 0, '自动取景必须算出相机距离');
  assert.ok(Number.isFinite(metrics.autoFrame.radius), '自动取景必须基于真实包围球');
  assert.ok(Array.isArray(metrics.bounds.min) && Array.isArray(metrics.bounds.max));
  const beforeControls = gl.drawCount;
  selectButtons.find((b) => b.sceneId === 'island-lighthouse').handlers.click({ currentTarget: selectButtons.find((b) => b.sceneId === 'island-lighthouse') });
  assert.equal(selectedName.textContent, '蜜糖灯塔');
  assert.match(selectedDescription.textContent, /灯塔/);
  autoButton.handlers.click({ currentTarget: autoButton });
  dayButton.handlers.click({ currentTarget: dayButton });
  tide.handlers.input({ currentTarget: tide });
  resetButton.handlers.click({ currentTarget: resetButton });
  assert.ok(gl.drawCount > beforeControls, 'object and environment controls redraw the WebGL scene');
  assert.equal(gl.getError(), gl.NO_ERROR);
});
