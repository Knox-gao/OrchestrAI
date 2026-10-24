/**
 * M7-B4D 任务 B：subjectCoverage 探针测试（10 类边界场景）
 *
 * 全部为合成几何 + 合成投影矩阵，零真实模型、零网络。
 * 覆盖任务书要求的：
 *   正常可见主体 / 过小 / 部分出画 / 完全在相机后方 / 视锥边界 /
 *   缺 sceneBrief 旧计划 / 主体 ID 不存在 / bounds 非有限值 / 不同宽高比 / 不同形状
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  SUBJECT_COVERAGE_METHOD, ndcToCanvas, transformVec4, aabbCorners,
  measureAabbCoverage, judgeSubjectCoverage, evaluateSubjectCoverage,
} from '../generator/pageplan/subject-coverage.mjs';

const IDENTITY = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);

/** 构造一个"把世界点沿 z 平移 -d 再投影"的简单透视矩阵，便于控制可见性。 */
function perspectiveAt(distance, fovy = Math.PI / 4, aspect = 1) {
  const f = 1 / Math.tan(fovy / 2);
  const n = 0.1, fa = 100, nf = 1 / (n - fa);
  const P = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (fa + n) * nf, -1, 0, 0, 2 * fa * n * nf, 0];
  // 平移到 -distance（列主序：第 12 项是 z 平移）
  const T = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,-distance,1];
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    out[c * 4 + r] = P[r] * T[c * 4] + P[4 + r] * T[c * 4 + 1] + P[8 + r] * T[c * 4 + 2] + P[12 + r] * T[c * 4 + 3];
  }
  return out;
}

// ---------------- 基础数学 ----------------

test('ndcToCanvas 做 y 轴翻转', () => {
  assert.deepEqual(ndcToCanvas([0, 0], 100, 50), { x: 50, y: 25 });
  assert.deepEqual(ndcToCanvas([-1, 1], 100, 50), { x: 0, y: 0 });
  assert.deepEqual(ndcToCanvas([1, -1], 100, 50), { x: 100, y: 50 });
});

test('transformVec4 按列主序变换', () => {
  const m = [1,0,0,0, 0,1,0,0, 0,0,1,0, 5,6,7,1];
  assert.deepEqual(transformVec4(m, [1, 2, 3, 1]), [6, 8, 10, 1]);
});

test('aabbCorners 返回 8 个角', () => {
  const c = aabbCorners([0,0,0], [1,1,1]);
  assert.equal(c.length, 8);
  assert.ok(c.every((p) => p.length === 4 && p[3] === 1));
});

// ---------------- 场景 1：正常可见 ----------------

test('场景1 正常可见主体 → status=ok，占幅可算', () => {
  const r = measureAabbCoverage({ id: 's', min: [-0.3,-0.3,0], max: [0.3,0.3,0.01], viewProjection: IDENTITY, canvasWidth: 800, canvasHeight: 600 });
  assert.equal(r.status, 'ok');
  assert.equal(r.clipped, false);
  assert.ok(r.widthRatio > 0.2 && r.widthRatio < 0.4);
  assert.equal(r.method, SUBJECT_COVERAGE_METHOD);
});

// ---------------- 场景 2：过小 ----------------

test('场景2 主体过小 → 判 blocking（几乎不可见）', () => {
  const r = measureAabbCoverage({ id: 'tiny', min: [-0.002,-0.002,0], max: [0.002,0.002,0.01], viewProjection: IDENTITY, canvasWidth: 800, canvasHeight: 600 });
  const j = judgeSubjectCoverage(r, [0.35, 0.65]);
  assert.equal(j.verdict, 'blocking');
});

test('场景2b 主体略小于目标下限 → warning（不是 pass）', () => {
  // NDC 宽度 0.5（-0.25..0.25）对应画布占幅 25%；目标下限 35%，
  // 但 25% > 17.5%（下限的一半），因此是 warning 而非 blocking。
  const r = measureAabbCoverage({ id: 'small', min: [-0.25,-0.25,0], max: [0.25,0.25,0.01], viewProjection: IDENTITY, canvasWidth: 800, canvasHeight: 600 });
  const j = judgeSubjectCoverage(r, [0.35, 0.65]);
  assert.equal(j.verdict, 'warning');
  assert.match(j.reasons.join(), /低于目标下限/);
});

// ---------------- 场景 3：部分出画 ----------------

test('场景3 主体部分出画 → clipped=true 且判 warning（不能 pass）', () => {
  // 左边超出：x from -1.5 到 0.5
  const r = measureAabbCoverage({ id: 'clip', min: [-1.5,-0.2,0], max: [0.5,0.2,0.01], viewProjection: IDENTITY, canvasWidth: 800, canvasHeight: 600 });
  assert.equal(r.clipped, true);
  assert.ok(r.overflow.left > 0, '应记录左侧溢出像素');
  const j = judgeSubjectCoverage(r, [0.1, 0.4]);
  assert.equal(j.verdict, 'warning', '裁切时即使占幅在区间内也不得 pass');
});

test('场景3b 1–2px 贴边不算裁切（容差）', () => {
  // 画布底部对应 ndcY = -1。ndcY = -1 - 4/600 时画布 y = 602 → 溢出 2px。
  // 1% 容差 = 6px > 2px → 不应判裁切。
  const r = measureAabbCoverage({ id: 'edge', min: [-0.2,-1.0067,0], max: [0.2,0.3,0.01], viewProjection: IDENTITY, canvasWidth: 800, canvasHeight: 600 });
  assert.ok(r.overflow.bottom > 0 && r.overflow.bottom < 6, `实际溢出 ${r.overflow.bottom}px`);
  assert.equal(r.clipped, false, '1% 容差内的贴边不算裁切');
});

// ---------------- 场景 4：完全在相机后方 ----------------

test('场景4 主体完全在相机后方 → behind_camera → blocking', () => {
  // w = -z，若 z 全为负（相机后），w<0
  const NEG_W = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,-1]);
  const r = measureAabbCoverage({ id: 'behind', min: [-.3,-.3,1], max: [.3,.3,2], viewProjection: NEG_W, canvasWidth: 800, canvasHeight: 600 });
  assert.equal(r.status, 'behind_camera');
  assert.equal(r.cornersBehind, 8);
  assert.equal(judgeSubjectCoverage(r, [0.3, 0.6]).verdict, 'blocking');
});

// ---------------- 场景 5：视锥边界 ----------------

test('场景5 主体跨越近平面（部分角在相机后）→ 仍能测，但记录 behind 数量', () => {
  // 构造 w = z 的矩阵（列主序 m[11]=1）：z 为负的 4 个角 w<0 → 位于相机后方。
  const STRADDLE = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,1, 0,0,0,0]);
  const r = measureAabbCoverage({ id: 'straddle', min: [-0.4,-0.4,-0.9], max: [0.4,0.4,0.9], viewProjection: STRADDLE, canvasWidth: 800, canvasHeight: 600 });
  assert.ok(r.cornersBehind > 0 && r.cornersBehind < 8, `应有部分角在后方，实际 ${r.cornersBehind}`);
  assert.equal(r.status, 'ok', '部分可见仍应给出测量');
});

test('场景5b 透视矩阵下远近主体占幅不同（近大远小）', () => {
  const near = measureAabbCoverage({ id: 'near', min: [-1,-1,-1], max: [1,1,1], viewProjection: perspectiveAt(4), canvasWidth: 800, canvasHeight: 600 });
  const far = measureAabbCoverage({ id: 'far', min: [-1,-1,-1], max: [1,1,1], viewProjection: perspectiveAt(12), canvasWidth: 800, canvasHeight: 600 });
  assert.ok(near.widthRatio > far.widthRatio, `近处占幅应更大：near=${near.widthRatio} far=${far.widthRatio}`);
});

// ---------------- 场景 6：缺 sceneBrief 的旧计划 ----------------

test('场景6 缺 sceneBrief → warning（绝不 pass），且不阻断旧计划', () => {
  const frames = { subj: { min: [-.3,-.3,0], max: [.3,.3,.01] } };
  const r = evaluateSubjectCoverage({ brief: null, objectFrames: frames, viewProjection: IDENTITY, canvasWidth: 800, canvasHeight: 600 });
  assert.equal(r.verdict, 'warning', '缺 brief 不能判 pass');
  assert.match(r.reasons.join(), /未指定主体|无法测量/);
});

test('场景6b 有 brief 但没给 subjectCoverage 区间 → warning', () => {
  const frames = { subj: { min: [-.3,-.3,0], max: [.3,.3,.01] } };
  const brief = { subject: { id: 'subj' }, composition: {} };
  const r = evaluateSubjectCoverage({ brief, objectFrames: frames, viewProjection: IDENTITY, canvasWidth: 800, canvasHeight: 600 });
  assert.equal(r.verdict, 'warning');
  assert.match(r.reasons.join(), /缺少|无法判定/);
});

// ---------------- 场景 7：主体 ID 不存在 ----------------

test('场景7 主体 ID 不在场景中 → warning + 明确原因', () => {
  const frames = { other: { min: [-.3,-.3,0], max: [.3,.3,.01] } };
  const brief = { subject: { id: 'ghost' }, composition: { subjectCoverage: [0.3, 0.6] } };
  const r = evaluateSubjectCoverage({ brief, objectFrames: frames, viewProjection: IDENTITY, canvasWidth: 800, canvasHeight: 600 });
  assert.equal(r.verdict, 'warning');
  assert.equal(r.subjectId, 'ghost');
  assert.match(r.reasons.join(), /不在本次渲染/);
});

// ---------------- 场景 8：bounds 不可用 ----------------

test('场景8 bounds 含 NaN → invalid_bounds', () => {
  const r = measureAabbCoverage({ id: 'nan', min: [NaN,0,0], max: [1,1,1], viewProjection: IDENTITY, canvasWidth: 800, canvasHeight: 600 });
  assert.equal(r.status, 'invalid_bounds');
});

test('场景8b bounds min>max → invalid_bounds', () => {
  const r = measureAabbCoverage({ id: 'inv', min: [1,1,1], max: [0,0,0], viewProjection: IDENTITY, canvasWidth: 800, canvasHeight: 600 });
  assert.equal(r.status, 'invalid_bounds');
});

test('场景8c 退化 bounds（零宽）→ degenerate', () => {
  const r = measureAabbCoverage({ id: 'flat', min: [0,0,0], max: [0,0,0], viewProjection: IDENTITY, canvasWidth: 800, canvasHeight: 600 });
  assert.ok(['degenerate', 'invalid_bounds'].includes(r.status), `实际 ${r.status}`);
});

test('场景8d 投影矩阵不可用 / 画布为 0 → degenerate 且不 pass', () => {
  assert.equal(measureAabbCoverage({ id: 'x', min: [0,0,0], max: [1,1,1], viewProjection: null, canvasWidth: 800, canvasHeight: 600 }).status, 'degenerate');
  assert.equal(measureAabbCoverage({ id: 'y', min: [0,0,0], max: [1,1,1], viewProjection: IDENTITY, canvasWidth: 0, canvasHeight: 0 }).status, 'degenerate');
});

// ---------------- 场景 9：不同宽高比 ----------------

test('场景9 宽画布 vs 高画布 → 占幅比例随宽高比变化且都有界', () => {
  // 必须用带 aspect 的透视矩阵；正交（单位矩阵）下 NDC 占幅比例与画布宽高比无关。
  const box = { min: [-1,-1,-1], max: [1,1,1] };
  const wide = measureAabbCoverage({ id: 'w', ...box, viewProjection: perspectiveAt(12, Math.PI / 4, 1600 / 400), canvasWidth: 1600, canvasHeight: 400 });
  const tall = measureAabbCoverage({ id: 't', ...box, viewProjection: perspectiveAt(12, Math.PI / 4, 400 / 1600), canvasWidth: 400, canvasHeight: 1600 });
  assert.equal(wide.status, 'ok');
  assert.equal(tall.status, 'ok');
  // 同一个世界盒子：宽画布上占宽度比例更小；两者的高度比例由各自 aspect 决定，
  // 因此只断言"宽画布宽度占比 < 高画布宽度占比"（实测 0.055 vs 0.878）。
  assert.ok(wide.widthRatio < tall.widthRatio, `宽画布宽度占比应更小：wide=${wide.widthRatio} tall=${tall.widthRatio}`);
  for (const r of [wide, tall]) {
    assert.ok(r.widthRatio > 0 && r.widthRatio <= 1);
    assert.ok(r.heightRatio > 0 && r.heightRatio <= 1);
  }
});

// ---------------- 场景 10：不同形状 ----------------

test('场景10 不同形状（纯几何，与形状名无关，只依赖真实 bounds）', async () => {
  // 关键证据：探针只吃 AABB，因此 dome/tree/lighthouse 只要 bounds 正确就同样工作。
  const planText = await readFile(new URL('../../../examples/m7b4c-themes/dome.json', import.meta.url), 'utf8');
  const plan = JSON.parse(planText);
  const findScene = (nodes) => {
    for (const n of nodes ?? []) {
      if (n.type === 'scene3d') return n;
      const f = findScene(n.children);
      if (f) return f;
    }
    return null;
  };
  const scene = findScene(plan.nodes);
  const subject = scene.objects.find((o) => o.id === plan.sceneBrief.subject.id);
  assert.ok(subject, '主体应存在于场景');

  // 用对象 scale 近似 AABB 验证探针对任意 shape 一视同仁
  const half = subject.scale.map((v) => v * 0.5);
  const min = subject.position.map((v, i) => v - half[i]);
  const max = subject.position.map((v, i) => v + half[i]);
  const r = measureAabbCoverage({ id: subject.id, min, max, viewProjection: perspectiveAt(14), canvasWidth: 1051, canvasHeight: 560 });
  assert.equal(r.status, 'ok', `dome 主体应可测量：${r.reason}`);
});

// ---------------- 判定契约 ----------------

test('判定契约：无测量结果 → warning 且不得为 pass', () => {
  const j = judgeSubjectCoverage(null, [0.3, 0.6]);
  assert.equal(j.verdict, 'warning');
});

test('判定契约：无目标区间 → warning（只报告事实）', () => {
  const r = measureAabbCoverage({ id: 's', min: [-.3,-.3,0], max: [.3,.3,.01], viewProjection: IDENTITY, canvasWidth: 800, canvasHeight: 600 });
  const j = judgeSubjectCoverage(r, null);
  assert.equal(j.verdict, 'warning');
});

test('判定契约：落在区间内且不裁切 → pass', () => {
  // NDC ±0.5 → 画布占幅 50%，目标 40–60%
  const r = measureAabbCoverage({ id: 's', min: [-0.5,-0.5,0], max: [0.5,0.5,0.01], viewProjection: IDENTITY, canvasWidth: 800, canvasHeight: 600 });
  const j = judgeSubjectCoverage(r, [0.4, 0.6]);
  assert.equal(j.verdict, 'pass');
});

test('探针输出带 method 与 approx 标记（不得被当作精确像素面积）', () => {
  const r = measureAabbCoverage({ id: 's', min: [-.2,-.2,0], max: [.2,.2,.01], viewProjection: IDENTITY, canvasWidth: 800, canvasHeight: 600 });
  assert.equal(r.method, 'aabb-8corner-projection');
  const j = judgeSubjectCoverage(r, [0.3, 0.6]);
  assert.ok(j.measurement.method);
});
