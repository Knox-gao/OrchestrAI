/**
 * M7-B4D 任务 B：主体实际可见投影占幅探针（纯数学，可单测）
 *
 * 为什么单独成模块：这段数学必须在 Node 里被合成用例覆盖（含相机后方点、视锥裁切、
 * 极端宽高比），同时又要原样内联进浏览器 runtime。所以：
 *   - 这里只写**无 DOM/无 GL 依赖**的纯函数
 *   - scene3d.mjs 通过 .toString() 把它注入 runtime（与现有 SCENE3D_RUNTIME 同法）
 *
 * 重要声明（会写进报告与 UI）：
 *   AABB 八角投影得到的占幅是**近似指标**，它不等于主体真实像素面积，
 *   也不等于"视觉焦点是否成立"。它只能回答"主体在画面上大概占多大、有没有出画"。
 */

export const SUBJECT_COVERAGE_METHOD = 'aabb-8corner-projection';

/**
 * 把 NDC 坐标转成画布像素坐标（y 轴翻转：NDC y 向上，canvas y 向下）。
 */
export function ndcToCanvas(ndc, width, height) {
  return {
    x: (ndc[0] * 0.5 + 0.5) * width,
    y: (1 - (ndc[1] * 0.5 + 0.5)) * height,
  };
}

/**
 * 用 4x4 列主序矩阵变换一个齐次点。
 * @param {Float32Array|number[]} m 列主序（与 gl-matrix / 现有 matMul 一致）
 * @param {number[]} p [x,y,z,1]
 * @returns {number[]} [x,y,z,w]
 */
export function transformVec4(m, p) {
  const [x, y, z, w] = p;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12] * w,
    m[1] * x + m[5] * y + m[9] * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w,
    m[3] * x + m[7] * y + m[11] * z + m[15] * w,
  ];
}

/** AABB 的 8 个角点。 */
export function aabbCorners(min, max) {
  if (!Array.isArray(min) || !Array.isArray(max) || min.length !== 3 || max.length !== 3) {
    throw new TypeError('aabbCorners 需要两个长度为 3 的数组');
  }
  const out = [];
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) out.push([x, y, z, 1]);
    }
  }
  return out;
}

/**
 * 投影一个 AABB，返回屏幕占幅。
 *
 * 处理三类异常：
 *   1. w <= 0（点在相机后方）→ 不计入可见包围框，但要记录 behind 数量
 *   2. 所有点都在相机后方 → status='behind_camera'
 *   3. 裁剪到画布边界之外的坐标 → 记录 clipping，并把 bounds 夹到画布内用于占幅计算
 *
 * @returns {{
 *   status:'ok'|'behind_camera'|'degenerate'|'invalid_bounds',
 *   id:string, canvas:{width:number,height:number},
 *   projectedBounds:{x0:number,y0:number,x1:number,y1:number}|null,
 *   widthRatio:number|null, heightRatio:number|null, areaRatio:number|null,
 *   clipped:boolean, touchesEdge:{left:boolean,right:boolean,top:boolean,bottom:boolean}|null,
 *   cornersBehind:number, reason:string
 * }}
 */
export function measureAabbCoverage({ id, min, max, viewProjection, canvasWidth, canvasHeight }) {
  const base = {
    id: id ?? null,
    method: SUBJECT_COVERAGE_METHOD,
    canvas: { width: canvasWidth ?? null, height: canvasHeight ?? null },
    projectedBounds: null,
    widthRatio: null,
    heightRatio: null,
    areaRatio: null,
    clipped: false,
    touchesEdge: null,
    cornersBehind: 0,
    status: 'ok',
    reason: '',
  };

  if (!Array.isArray(min) || !Array.isArray(max)
      || min.length !== 3 || max.length !== 3
      || ![...min, ...max].every((v) => typeof v === 'number' && Number.isFinite(v))
      || min.some((v, i) => v > max[i])) {
    return { ...base, status: 'invalid_bounds', reason: 'AABB 缺失、非有限值或 min>max' };
  }
  if (!viewProjection || typeof viewProjection.length !== 'number' || viewProjection.length !== 16) {
    return { ...base, status: 'degenerate', reason: 'viewProjection 矩阵不可用' };
  }
  if (!(canvasWidth > 0) || !(canvasHeight > 0)) {
    return { ...base, status: 'degenerate', reason: '画布尺寸无效' };
  }

  const pts = [];
  let behind = 0;
  for (const corner of aabbCorners(min, max)) {
    const clip = transformVec4(viewProjection, corner);
    const w = clip[3];
    if (!(w > 1e-6)) { behind++; continue; }   // 相机后方或恰在近平面
    pts.push([clip[0] / w, clip[1] / w, clip[2] / w]);
  }

  if (pts.length === 0) {
    return { ...base, cornersBehind: behind, status: 'behind_camera', reason: '全部 8 个角点位于相机后方' };
  }

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const ndc of pts) {
    const c = ndcToCanvas(ndc, canvasWidth, canvasHeight);
    if (c.x < x0) x0 = c.x; if (c.x > x1) x1 = c.x;
    if (c.y < y0) y0 = c.y; if (c.y > y1) y1 = c.y;
  }

  if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) {
    return { ...base, cornersBehind: behind, status: 'degenerate', reason: '投影后包围框退化（宽或高为 0）' };
  }

  // 容差：溢出量 < 画布尺寸的 1% 视为「贴边」（视觉上仍完整），不算裁切。
  // 否则自动取景留的 1-2px 安全边距会被误判成构图失误（实测踩到：溢出 2.5px / 560px）。
  const tolX = Math.max(1, canvasWidth * 0.01);
  const tolY = Math.max(1, canvasHeight * 0.01);
  const touchesEdge = {
    left: x0 <= 0.5,
    right: x1 >= canvasWidth - 0.5,
    top: y0 <= 0.5,
    bottom: y1 >= canvasHeight - 0.5,
  };
  const overflow = {
    left: Math.max(0, -x0),
    right: Math.max(0, x1 - canvasWidth),
    top: Math.max(0, -y0),
    bottom: Math.max(0, y1 - canvasHeight),
  };
  const clipped = overflow.left > tolX || overflow.right > tolX || overflow.top > tolY || overflow.bottom > tolY;

  // 占幅按"与画布的交集"计算：出画部分不计入（它不在画面上）
  const cx0 = Math.max(0, x0), cy0 = Math.max(0, y0);
  const cx1 = Math.min(canvasWidth, x1), cy1 = Math.min(canvasHeight, y1);
  const visibleW = Math.max(0, cx1 - cx0);
  const visibleH = Math.max(0, cy1 - cy0);

  return {
    ...base,
    projectedBounds: {
      x0: Math.round(x0 * 10) / 10, y0: Math.round(y0 * 10) / 10,
      x1: Math.round(x1 * 10) / 10, y1: Math.round(y1 * 10) / 10,
    },
    widthRatio: Math.round((visibleW / canvasWidth) * 1000) / 1000,
    heightRatio: Math.round((visibleH / canvasHeight) * 1000) / 1000,
    areaRatio: Math.round((visibleW * visibleH / (canvasWidth * canvasHeight)) * 1000) / 1000,
    clipped,
    touchesEdge,
    overflow: {
      left: Math.round(overflow.left * 10) / 10,
      right: Math.round(overflow.right * 10) / 10,
      top: Math.round(overflow.top * 10) / 10,
      bottom: Math.round(overflow.bottom * 10) / 10,
    },
    cornersBehind: behind,
    status: 'ok',
    reason: clipped ? '主体触及画布边界，占幅按可见区域计算' : '',
  };
}

/**
 * 把测量结果与 brief 的目标区间比较，给出 pass/warning/blocking。
 *
 * 判定原则（任务书要求"不得将无法测量当作通过"）：
 *   - 无法测量 → warning（绝不 pass）
 *   - 完全没有可见区域（面积 ≈ 0）→ blocking（主体不可见）
 *   - 占幅低于区间下限的一半 → blocking（主体几乎看不见）
 *   - 占幅低于下限 → warning
 *   - 触及边界（被裁切）→ warning（可能构图失误，但主体仍在）
 *   - 在区间内且不裁切 → pass
 */
export function judgeSubjectCoverage(measurement, targetRange) {
  const out = {
    measurement: measurement ?? null,
    target: Array.isArray(targetRange) && targetRange.length === 2 ? targetRange : null,
    verdict: 'warning',
    reasons: [],
  };

  if (!measurement) {
    out.reasons.push('无测量结果');
    return out;
  }
  if (measurement.status !== 'ok') {
    out.reasons.push(`无法测量：${measurement.status}（${measurement.reason || '原因未知'}）`);
    // 主体完全在相机后方是明确错误
    if (measurement.status === 'behind_camera') out.verdict = 'blocking';
    return out;
  }

  const area = measurement.areaRatio;
  const width = measurement.widthRatio;
  if (typeof area !== 'number' || area <= 0.0005) {
    out.verdict = 'blocking';
    out.reasons.push(`主体在画面上几乎不可见（可见面积占比 ${area}）`);
    return out;
  }

  // 没有目标区间：只能报告事实，不能判通过
  if (!out.target) {
    out.verdict = 'warning';
    out.reasons.push('缺少 brief 的 subjectCoverage 目标区间，无法判定是否达标');
    return out;
  }

  const [lo, hi] = out.target;
  // 用"宽高比的平均"作为主指标：AABB 面积比会因形状拉长而偏差更大
  const primary = (typeof width === 'number' ? width : area);
  const below = primary < lo;
  const above = primary > hi;

  if (primary < lo * 0.5) {
    out.verdict = 'blocking';
    out.reasons.push(`主体宽度占幅 ${(primary * 100).toFixed(1)}% 远低于目标下限 ${(lo * 100).toFixed(0)}%`);
  } else if (below) {
    out.verdict = 'warning';
    out.reasons.push(`主体宽度占幅 ${(primary * 100).toFixed(1)}% 低于目标下限 ${(lo * 100).toFixed(0)}%`);
  } else if (above) {
    out.verdict = 'warning';
    out.reasons.push(`主体宽度占幅 ${(primary * 100).toFixed(1)}% 高于目标上限 ${(hi * 100).toFixed(0)}%`);
  }

  if (measurement.clipped) {
    // 裁切会让"占幅"失真，因此不能因为它在区间内就判 pass
    if (out.verdict === 'warning' ? !below && !above : true) {
      out.verdict = 'warning';
    }
    out.reasons.push('主体触及画布边界（被裁切），占幅按可见区域计算，构图需人工复核');
  }

  if (out.verdict !== 'blocking' && !below && !above && !measurement.clipped) {
    out.verdict = 'pass';
    out.reasons.push(`主体宽度占幅 ${(primary * 100).toFixed(1)}% 落在目标区间 ${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}%`);
  }

  return out;
}

/**
 * 从原始几何数据算主体实际可见占幅（组装层）。
 * 缺 brief / 缺主体 / bounds 不可用时，一律 warning 而不是 pass。
 */
export function evaluateSubjectCoverage({ brief, objectFrames, viewProjection, canvasWidth, canvasHeight, fallbackSubjectId = null }) {
  const subjectId = brief?.subject?.id ?? fallbackSubjectId;
  const target = brief?.composition?.subjectCoverage ?? null;

  if (!subjectId) {
    return {
      ...judgeSubjectCoverage(null, target),
      subjectId: null,
      verdict: 'warning',
      reasons: ['未指定主体（brief.subject.id 缺失），无法测量主体占幅'],
    };
  }
  const frame = objectFrames?.[subjectId] ?? objectFrames?.get?.(subjectId) ?? null;
  if (!frame) {
    return {
      ...judgeSubjectCoverage(null, target),
      subjectId,
      verdict: 'warning',
      reasons: [`主体 "${subjectId}" 不在本次渲染的对象集合中，无法测量`],
    };
  }
  const measurement = measureAabbCoverage({
    id: subjectId, min: frame.min, max: frame.max,
    viewProjection, canvasWidth, canvasHeight,
  });
  return { ...judgeSubjectCoverage(measurement, target), subjectId, target };
}
