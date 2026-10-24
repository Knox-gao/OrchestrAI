/**
 * Scene 渲染检查（M7-B4C）：把"看着不对"变成可自动检测的几何/构图指标。
 *
 * 分工（任务书第三节 C）：
 *   - 自动指标：裁切、体积、悬空/半埋、轮廓可辨、材质可分、死白/死黑、焦点明确度
 *   - 人工判断：美术完成度、与参考图的接近度（绝不假装自动通过）
 *
 * 所有指标都基于**真实几何与真实渲染数据**，不基于字符串关键字。
 */

import { SCENE3D_COMPOSITES } from './scene3d.mjs';

const COMPOSITE_SET = new Set(SCENE3D_COMPOSITES);
const GROUND_SHAPES = new Set(['terrain', 'island', 'plateau']);
const EPS = 1e-6;

/** 把场景对象按语义 ID 聚合成"物件级"包围盒（复合原语会展开成多个 mesh）。 */
export function aggregateObjectBounds(sceneNode) {
  const out = new Map();
  for (const obj of sceneNode?.objects ?? []) {
    const [px, py, pz] = obj.position ?? [0, 0, 0];
    const [sx, sy, sz] = obj.scale ?? [1, 1, 1];
    // 用单位包围盒 × scale 作为保守估计；复合原语的实际部件都在这个范围内
    const halfX = Math.abs(sx) * 0.5, halfY = Math.abs(sy) * 0.5, halfZ = Math.abs(sz) * 0.5;
    out.set(obj.id, {
      id: obj.id,
      shape: obj.shape,
      material: obj.material,
      layer: obj.layer ?? null,
      role: obj.role ?? null,
      selectable: obj.selectable === true,
      min: [px - halfX, py - halfY, pz - halfZ],
      max: [px + halfX, py + halfY, pz + halfZ],
      center: [px, py, pz],
      size: [halfX * 2, halfY * 2, halfZ * 2],
    });
  }
  return out;
}

/**
 * 几何检查：不依赖浏览器，纯几何推断。
 * @returns {{findings: Array, metrics: Object}}
 */
export function checkSceneGeometry(sceneNode, brief = null) {
  const findings = [];
  const objects = sceneNode?.objects ?? [];
  if (!objects.length) {
    return { findings: [{ code: 'SCENE_EMPTY', severity: 'blocking', detail: '场景没有任何对象' }], metrics: { objects: 0 } };
  }
  const boxes = aggregateObjectBounds(sceneNode);
  const list = [...boxes.values()];

  // ---- 1) 地面/基座体积 ----
  const ground = list.filter((b) => GROUND_SHAPES.has(b.shape));
  const groundTop = ground.length ? Math.max(...ground.map((b) => b.max[1])) : null;
  if (!ground.length) findings.push({ code: 'NO_VOLUME_GROUND', severity: 'warning', detail: '没有地形/基座类对象（terrain/island/plateau），底座可能只是一层薄片' });
  else {
    const thickest = ground.reduce((a, b) => (b.size[1] > a.size[1] ? b : a));
    if (thickest.size[1] < 0.25) findings.push({ code: 'GROUND_TOO_THIN', severity: 'warning', detail: `地形/底座最厚处仅 ${thickest.size[1].toFixed(2)}，缺少可见的地层剖面厚度` });
  }

  // ---- 2) 悬空 / 半埋（保守判定：只报"明显在地面之上/之内"的情形）----
  // M7-B4D 审计（含可复现反例）：旧实现用全局 groundTop，把"山脚房子"误判为半埋。
  // 修正后改用局部重叠范围，但**AABB 无法表达坡面**——地形 AABB 覆盖整个水平投影，
  // 山脚在 AABB 里仍是"顶面高度"。因此这里再收窄为只报两种情况：
  //   (a) 物件底部高于**所有**地面对象的顶面（真的悬在空中）
  //   (b) 物件顶部低于**所有**地面对象的底面（真的整个埋在地面之下）
  // 坡面/台阶等中间情形不在几何层判定，交由渲染截图人工复核——宁可漏报也不误报。
  if (groundTop !== null) {
    const groundBoxes = list.filter((b) => GROUND_SHAPES.has(b.shape));
    const maxGroundTop = groundBoxes.length ? Math.max(...groundBoxes.map((g) => g.max[1])) : groundTop;
    const minGroundBottom = groundBoxes.length ? Math.min(...groundBoxes.map((g) => g.min[1])) : groundTop;

    const standing = list.filter((b) => !GROUND_SHAPES.has(b.shape) && b.size[1] >= 0.2);
    const floating = standing.filter((b) => b.min[1] > maxGroundTop + 0.35);
    const buried = standing.filter((b) => b.max[1] < minGroundBottom - 0.05);

    if (floating.length) findings.push({ code: 'OBJECTS_FLOATING', severity: 'warning', detail: `${floating.length} 个物件悬空（底部高于地面最高点 ${maxGroundTop.toFixed(2)}）：${floating.slice(0, 4).map((b) => b.id).join('、')}` });
    if (buried.length) findings.push({ code: 'OBJECTS_BURIED', severity: 'warning', detail: `${buried.length} 个物件整体埋在地面之下（顶部低于地面最低点 ${minGroundBottom.toFixed(2)}）：${buried.slice(0, 4).map((b) => b.id).join('、')}` });
  }

  // ---- 3) 物件互相重叠（中心距 < 两者平均尺寸的 40%）----
  const overlaps = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.shape === 'terrain' || b.shape === 'terrain' || a.shape === 'island' || b.shape === 'island' || a.shape === 'plateau' || b.shape === 'plateau') continue;
      // M7-B4D 审计（含可复现反例）：旧实现用「两者最大尺寸」，两根平行栈桥
      // （10×0.5×0.5，中心距 1）会被误判为重叠。改成**沿分离方向的厚度**：
      // 只有当一个物体真的伸进另一个物体的截面范围内才算重叠——细长物体沿长轴分开不算。
      const dx = b.center[0] - a.center[0];
      const dy = b.center[1] - a.center[1];
      const dz = b.center[2] - a.center[2];
      const d = Math.hypot(dx, dy, dz);
      if (d > EPS) {
        // 各轴上的半宽之和 = 该轴上的"接触距离"；分离方向由最大分量决定
        const ax = (a.size[0] + b.size[0]) / 2, ay = (a.size[1] + b.size[1]) / 2, az = (a.size[2] + b.size[2]) / 2;
        const adx = Math.abs(dx), ady = Math.abs(dy), adz = Math.abs(dz);
        const dominant = adx >= ady && adx >= adz ? 'x' : (ady >= adz ? 'y' : 'z');
        const sep = dominant === 'x' ? adx : dominant === 'y' ? ady : adz;
        const reach = dominant === 'x' ? ax : dominant === 'y' ? ay : az;
        // 沿主分离方向"穿进去了"（sep < reach）且穿透超过 55% 才算明显重叠
        if (sep < reach * 0.55) overlaps.push(`${a.id}×${b.id}`);
      }
    }
  }
  if (overlaps.length) findings.push({ code: 'OBJECTS_OVERLAP', severity: 'warning', detail: `${overlaps.length} 对物件明显重叠：${overlaps.slice(0, 3).join('、')}` });

  // ---- 4) 材质可区分度（材质名 = 渲染参数档位，这是正确的判据）----
  // M7-B4D 审计结论（修正了一个错误假设）：
  //   材质名不是"标签"，它在渲染器里映射到**不同的 gloss 档位**：
  //     jelly=0.94 / matte=0.18 / metal=0.72 / foliage=0.28 / wood=0.12 / stone=0.16 / water=0.88 / sand=0.10
  //   （见 scene3d.mjs 的 MATERIALS 常量）
  //   所以"材质名不同"确实等于"渲染参数不同"。因此用材质名判定是**正确**的，
  //   不能改成"名称+颜色"联合键——那会把 3 个不同 gloss 的物体误判为同一种。
  //   颜色作为独立信号另行记录（materialSurfaces），但**不参与**单调性判定。
  const materialNames = [...new Set(objects.map((o) => o.material).filter(Boolean))];
  if (materialNames.length < 2) {
    findings.push({
      code: 'MATERIAL_MONOTONE',
      severity: 'blocking',
      detail: `全场景只有 ${materialNames.length} 种材质（${materialNames.join('、') || '无'}），无法形成 gloss/粗糙度差异`,
    });
  } else if (materialNames.length < 3) {
    findings.push({ code: 'MATERIAL_LOW_VARIETY', severity: 'warning', detail: `只有 ${materialNames.length} 种材质，层次偏单薄` });
  }
  const surfaceKeys = new Set(objects.filter((o) => o.material).map((o) => `${o.material}|${String(o.color ?? '').toLowerCase()}`));

  // ---- 5) 棱角/复杂度（轮廓可辨的粗代理：复合原语 vs 纯 primitive 占比）----
  const composites = objects.filter((o) => COMPOSITE_SET.has(o.shape));
  const compositeRatio = composites.length / objects.length;
  if (compositeRatio === 0) findings.push({ code: 'NO_COMPOSITE_SHAPES', severity: 'warning', detail: '所有对象都是基础几何（sphere/box/cylinder…），易呈现"球柱方块堆叠"；应改用复合原语（house/tree/lighthouse…）' });
  else if (compositeRatio < 0.25) findings.push({ code: 'LOW_COMPOSITE_RATIO', severity: 'warning', detail: `复合原语仅占 ${(compositeRatio * 100).toFixed(0)}%，细节可能不足` });

  // ---- 6) 主体存在性与显著性 ----
  const subjectId = brief?.subject?.id ?? null;
  let subject = subjectId ? boxes.get(subjectId) : null;
  if (!subjectId && brief) findings.push({ code: 'BRIEF_SUBJECT_MISSING', severity: 'blocking', detail: 'brief 未声明 subject.id' });
  if (subjectId && !subject) findings.push({ code: 'SUBJECT_NOT_RENDERED', severity: 'blocking', detail: `主体 "${subjectId}" 未出现在场景中` });
  if (subject) {
    const maxDim = Math.max(subject.size[0], subject.size[1], subject.size[2]);
    // M7-B4D 审计：地面/底座不是"视觉竞争者"，把它们算进中位数会把阈值拉到地形尺寸，
    // 导致"主体明显大于所有道具"仍被判为不够显著（实测：地形 20 宽 vs 主体 6）。
    const others = list
      .filter((b) => b.id !== subject.id && !GROUND_SHAPES.has(b.shape))
      .map((b) => Math.max(...b.size));
    const medianOther = others.length ? others.sort((a, b) => a - b)[Math.floor(others.length / 2)] : 0;
    if (medianOther > 0 && maxDim < medianOther * 1.15) {
      findings.push({ code: 'SUBJECT_NOT_DOMINANT', severity: 'warning', detail: `主体最大边 ${maxDim.toFixed(2)} 并不明显大于其他物件中位数 ${medianOther.toFixed(2)}，视觉焦点可能不明确` });
    }
    if (!subject.selectable) findings.push({ code: 'SUBJECT_NOT_SELECTABLE', severity: 'warning', detail: '主体未标记 selectable，用户无法点选查看档案' });
  }

  // ---- 7) 景深层次（按 brief 的 layer 注解 + 实际 z 分布双重判断）----
  if (brief?.objects) {
    const layers = new Set(brief.objects.map((o) => o.layer));
    if (layers.size < 2) findings.push({ code: 'NO_DEPTH_LAYERS', severity: 'blocking', detail: 'brief 未形成前中后景层次' });
  }
  const zs = list.map((b) => b.center[2]);
  const zSpread = zs.length ? Math.max(...zs) - Math.min(...zs) : 0;
  const xSpread = list.length ? Math.max(...list.map((b) => b.center[0])) - Math.min(...list.map((b) => b.center[0])) : 0;
  if (list.length >= 4 && zSpread < xSpread * 0.15) findings.push({ code: 'FLAT_LAYOUT', severity: 'warning', detail: `对象在景深方向几乎无分布（z 跨度 ${zSpread.toFixed(2)} vs x 跨度 ${xSpread.toFixed(2)}），前中后景不成立` });

  // ---- 8) 对象数量与密度 ----
  if (objects.length < 4) findings.push({ code: 'SCENE_TOO_SPARSE', severity: 'warning', detail: `只有 ${objects.length} 个对象，难以形成主体/次体/点缀三层` });
  if (objects.length > 40) findings.push({ code: 'SCENE_TOO_DENSE', severity: 'warning', detail: `${objects.length} 个对象偏多，容易杂乱` });

  const blocking = findings.filter((f) => f.severity === 'blocking');
  return {
    findings,
    metrics: {
      objects: objects.length,
      composites: composites.length,
      compositeRatio: Math.round(compositeRatio * 100) / 100,
      materials: materialNames,
      materialSurfaces: surfaceKeys.size,
      groundTop: groundTop === null ? null : Math.round(groundTop * 100) / 100,
      overlaps: overlaps.length,
      zSpread: Math.round(zSpread * 100) / 100,
      xSpread: Math.round(xSpread * 100) / 100,
      blocking: blocking.length,
      warnings: findings.length - blocking.length,
    },
  };
}

/**
 * 渲染后检查：基于真实 canvas 像素（由浏览器侧探针提供）。
 * 输入来自 scene3d runtime 的 data-scene3d-metrics + 额外采集的像素统计。
 */
export function checkSceneRendering(renderStats) {
  const findings = [];
  if (!renderStats || typeof renderStats !== 'object') {
    return { findings: [{ code: 'NO_RENDER_STATS', severity: 'blocking', detail: '缺少渲染统计' }], metrics: {} };
  }
  const { status, glError, whiteRatio, blackRatio, subjectCoverage, canvas, meshes, triangles } = renderStats;

  if (status !== 'ready') findings.push({ code: 'SCENE_NOT_READY', severity: 'blocking', detail: `3D 场景未就绪（status=${status}）` });
  if (glError !== 0 && glError !== '0' && glError !== undefined) findings.push({ code: 'WEBGL_ERROR', severity: 'blocking', detail: `gl.getError() = ${glError}` });
  if (!canvas || !canvas.width || !canvas.height) findings.push({ code: 'CANVAS_INVALID', severity: 'blocking', detail: 'canvas 尺寸无效' });

  if (typeof whiteRatio === 'number') {
    if (whiteRatio > 0.35) findings.push({ code: 'OVEREXPOSED', severity: 'blocking', detail: `纯白像素占 ${(whiteRatio * 100).toFixed(1)}%，存在大片死白` });
    else if (whiteRatio > 0.2) findings.push({ code: 'HOT_HIGHLIGHTS', severity: 'warning', detail: `纯白像素占 ${(whiteRatio * 100).toFixed(1)}%，高光偏强` });
  }
  if (typeof blackRatio === 'number' && blackRatio > 0.5 && status === 'ready') {
    findings.push({ code: 'TOO_DARK', severity: 'warning', detail: `近黑像素占 ${(blackRatio * 100).toFixed(1)}%，画面可能过暗或存在缺面` });
  }
  // 主体占画幅：由浏览器侧用主体包围盒投影到屏幕计算
  if (typeof subjectCoverage === 'number') {
    if (subjectCoverage < 0.08) findings.push({ code: 'SUBJECT_TOO_SMALL', severity: 'warning', detail: `主体仅占画幅 ${(subjectCoverage * 100).toFixed(1)}%，视觉焦点太弱` });
    else if (subjectCoverage > 0.85) findings.push({ code: 'SUBJECT_CLIPPED', severity: 'blocking', detail: `主体占画幅 ${(subjectCoverage * 100).toFixed(1)}%，可能被裁切` });
  }
  if (typeof meshes === 'number' && meshes === 0) findings.push({ code: 'NO_MESHES', severity: 'blocking', detail: '没有渲染任何网格' });

  return {
    findings,
    metrics: {
      status: status ?? null,
      glError: glError ?? null,
      whiteRatio: typeof whiteRatio === 'number' ? Math.round(whiteRatio * 1000) / 1000 : null,
      blackRatio: typeof blackRatio === 'number' ? Math.round(blackRatio * 1000) / 1000 : null,
      subjectCoverage: typeof subjectCoverage === 'number' ? Math.round(subjectCoverage * 1000) / 1000 : null,
      meshes: meshes ?? null,
      triangles: triangles ?? null,
      blocking: findings.filter((f) => f.severity === 'blocking').length,
      warnings: findings.filter((f) => f.severity === 'warning').length,
    },
  };
}

/**
 * 汇总：几何 + 渲染。blocking 任一出现 → 该轮不可交付。
 */
export function summariseSceneReview({ geometry, rendering }) {
  const all = [...(geometry?.findings ?? []), ...(rendering?.findings ?? [])];
  const blocking = all.filter((f) => f.severity === 'blocking');
  const warnings = all.filter((f) => f.severity === 'warning');
  return {
    ok: blocking.length === 0,
    blockingCount: blocking.length,
    warningCount: warnings.length,
    findings: all,
    // 明确声明：自动检查只能证明"没有明显硬伤"，不能证明"好看"
    note: '自动检查只覆盖可量化的几何/渲染硬伤；美术完成度与参考图接近度必须由人工看截图判定。',
  };
}
