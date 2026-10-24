/**
 * Scene Brief：结构化创作规划（M7-B4C）
 *
 * 为什么需要：
 *   审计发现 scene3d 的真实输入只有"绝对坐标 + scale + 颜色 + 材质枚举"。
 *   模型无法表达前中后景、视觉焦点、相对尺度、材质意图，只能凭坐标碰运气。
 *   于是"构图好不好"完全不可验证、也不可要求。
 *
 * 本模块把创作意图变成**可校验的结构化数据**：
 *   - 纯声明式，无任何可执行内容
 *   - 只做结构与一致性校验，不做主观审美判定
 *   - brief 与最终 scene3d 节点可交叉核对（brief 的对象 id 必须真的出现在场景里）
 *
 * 设计取舍（明确记录）：
 *   Scene Brief 与 PagePlan 在**同一次模型调用**里返回，不额外发一次请求。
 *   原因为"避免重复调用造成成本与延迟"（任务书第二节）。代价是"先有 brief 再生成 plan"
 *   在时间上是同批产出，因此用**交叉校验**来保证 plan 没有脱离 brief：
 *   brief 声明的学科对象/层次/材质必须能在实际 scene3d 节点里找到对应证据。
 */

export const SCENE_BRIEF_VERSION = 'orchestrai.scene-brief.v1';

export const SCENE_BRIEF_LIMITS = Object.freeze({
  maxObjects: 48,
  maxAcceptance: 8,
  maxMaterials: 8,
  maxSecondaryFocus: 4,
  maxText: 400,
});

const ID_RE = /^[a-z][a-z0-9-]{0,49}$/;
const CAMERA_ANGLES = new Set(['low', 'eye', 'high', 'isometric']);
const WHITESPACE = new Set(['tight', 'balanced', 'airy']);
const RELIEF = new Set(['flat', 'gentle', 'rolling', 'steep']);
const ROLES = new Set(['subject', 'secondary', 'accent']);
const LAYERS = new Set(['foreground', 'midground', 'background']);
const SCALE_HINTS = new Set(['tiny', 'small', 'medium', 'large', 'huge']);
/** 与 scene3d.mjs 的 SCENE3D_MATERIALS 保持同步；这里独立声明是为了让 brief 校验不依赖渲染器内部。 */
const MATERIALS = new Set(['jelly', 'matte', 'metal', 'foliage', 'wood', 'stone', 'water', 'sand']);

export class SceneBriefError extends Error {
  constructor(code, issues) {
    super(`Scene Brief 校验失败：${issues.slice(0, 6).join('; ')}`);
    this.name = 'SceneBriefError';
    this.code = code;
    this.issues = issues;
  }
}

const isStr = (v, max = SCENE_BRIEF_LIMITS.maxText) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * 校验 Scene Brief 结构。返回规范化副本；不合法则抛 SceneBriefError。
 * 只校验"能不能被机器核对"，不评价"好不好看"。
 */
export function validateSceneBrief(input) {
  const issues = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SceneBriefError('BRIEF_NOT_OBJECT', ['sceneBrief 必须是对象']);
  }
  const allowed = ['schemaVersion', 'theme', 'visualStyle', 'subject', 'secondaryFocus', 'composition', 'terrain', 'objects', 'materials', 'light', 'interaction', 'acceptance'];
  for (const key of Object.keys(input)) if (!allowed.includes(key)) issues.push(`sceneBrief 含未支持字段 "${key}"`);
  if (input.schemaVersion !== SCENE_BRIEF_VERSION) issues.push(`schemaVersion 必须是 ${SCENE_BRIEF_VERSION}`);

  if (!isStr(input.theme, 160)) issues.push('theme 必须是 1–160 字符的主题描述');
  if (!isStr(input.visualStyle, 240)) issues.push('visualStyle 必须是 1–240 字符的视觉风格描述');

  // 主体
  const subject = input.subject;
  if (!subject || typeof subject !== 'object' || Array.isArray(subject)) issues.push('subject 必须是对象');
  else {
    for (const key of Object.keys(subject)) if (!['id', 'description', 'silhouette'].includes(key)) issues.push(`subject 含未支持字段 "${key}"`);
    if (!ID_RE.test(String(subject.id ?? ''))) issues.push('subject.id 必须是 kebab-case 稳定 ID');
    if (!isStr(subject.description, 240)) issues.push('subject.description 必须是 1–240 字符');
    if (!isStr(subject.silhouette, 180)) issues.push('subject.silhouette 必须描述可辨认的轮廓特征（1–180 字符）');
  }

  // 次要焦点
  if (input.secondaryFocus != null) {
    if (!Array.isArray(input.secondaryFocus) || input.secondaryFocus.length > SCENE_BRIEF_LIMITS.maxSecondaryFocus) {
      issues.push(`secondaryFocus 必须是至多 ${SCENE_BRIEF_LIMITS.maxSecondaryFocus} 项的数组`);
    } else if (input.secondaryFocus.some((v) => !isStr(v, 160))) issues.push('secondaryFocus 每项必须是 1–160 字符');
  }

  // 构图
  const comp = input.composition;
  if (!comp || typeof comp !== 'object' || Array.isArray(comp)) issues.push('composition 必须是对象');
  else {
    for (const key of Object.keys(comp)) if (!['cameraAngle', 'subjectCoverage', 'whitespace', 'focalPoint'].includes(key)) issues.push(`composition 含未支持字段 "${key}"`);
    if (!CAMERA_ANGLES.has(comp.cameraAngle)) issues.push(`composition.cameraAngle 必须是 ${[...CAMERA_ANGLES].join('/')}`);
    if (!WHITESPACE.has(comp.whitespace)) issues.push(`composition.whitespace 必须是 ${[...WHITESPACE].join('/')}`);
    if (!Array.isArray(comp.subjectCoverage) || comp.subjectCoverage.length !== 2 || !comp.subjectCoverage.every(isNum)) {
      issues.push('composition.subjectCoverage 必须是 [min,max] 两个数字（0–1，表示主体应占画幅比例）');
    } else {
      const [lo, hi] = comp.subjectCoverage;
      if (lo < 0.05 || hi > 0.95 || lo >= hi) issues.push('composition.subjectCoverage 必须满足 0.05 ≤ min < max ≤ 0.95');
    }
    if (comp.focalPoint != null && !isStr(comp.focalPoint, 120)) issues.push('composition.focalPoint 必须是 1–120 字符');
  }

  // 地形
  const terrain = input.terrain;
  if (!terrain || typeof terrain !== 'object' || Array.isArray(terrain)) issues.push('terrain 必须是对象');
  else {
    for (const key of Object.keys(terrain)) if (!['kind', 'relief', 'layers'].includes(key)) issues.push(`terrain 含未支持字段 "${key}"`);
    if (!isStr(terrain.kind, 120)) issues.push('terrain.kind 必须是 1–120 字符（地面/基座类型）');
    if (!RELIEF.has(terrain.relief)) issues.push(`terrain.relief 必须是 ${[...RELIEF].join('/')}`);
    if (!Array.isArray(terrain.layers) || terrain.layers.length < 1 || terrain.layers.length > 6) issues.push('terrain.layers 必须是 1–6 项的层次描述');
    else if (terrain.layers.some((v) => !isStr(v, 120))) issues.push('terrain.layers 每项必须是 1–120 字符');
  }

  // 对象清单
  const objects = input.objects;
  if (!Array.isArray(objects) || objects.length < 1 || objects.length > SCENE_BRIEF_LIMITS.maxObjects) {
    issues.push(`objects 必须是 1–${SCENE_BRIEF_LIMITS.maxObjects} 项`);
  } else {
    const ids = new Set();
    let subjectCount = 0;
    const layerSet = new Set();
    for (const [i, obj] of objects.entries()) {
      const at = `objects[${i}]`;
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { issues.push(`${at} 必须是对象`); continue; }
      for (const key of Object.keys(obj)) if (!['id', 'role', 'scaleHint', 'layer', 'relation'].includes(key)) issues.push(`${at} 含未支持字段 "${key}"`);
      if (!ID_RE.test(String(obj.id ?? ''))) issues.push(`${at}.id 必须是 kebab-case 稳定 ID`);
      else if (ids.has(obj.id)) issues.push(`${at}.id 重复："${obj.id}"`);
      else ids.add(obj.id);
      if (!ROLES.has(obj.role)) issues.push(`${at}.role 必须是 ${[...ROLES].join('/')}`);
      if (obj.role === 'subject') subjectCount++;
      if (!SCALE_HINTS.has(obj.scaleHint)) issues.push(`${at}.scaleHint 必须是 ${[...SCALE_HINTS].join('/')}`);
      if (!LAYERS.has(obj.layer)) issues.push(`${at}.layer 必须是 ${[...LAYERS].join('/')}`);
      else layerSet.add(obj.layer);
      if (!isStr(obj.relation, 180)) issues.push(`${at}.relation 必须描述与主体的空间关系（1–180 字符）`);
    }
    if (subjectCount !== 1) issues.push(`objects 中 role="subject" 必须恰好 1 个，实际 ${subjectCount}`);
    if (layerSet.size < 2) issues.push('objects 必须至少覆盖 2 个景深层次（foreground/midground/background），否则无法形成前中后景');
    if (subject && ID_RE.test(String(subject.id ?? '')) && !ids.has(subject.id)) issues.push(`subject.id "${subject.id}" 必须出现在 objects 中`);
  }

  // 材质意图
  if (!Array.isArray(input.materials) || input.materials.length < 2 || input.materials.length > SCENE_BRIEF_LIMITS.maxMaterials) {
    issues.push(`materials 必须是 2–${SCENE_BRIEF_LIMITS.maxMaterials} 项（至少两种可区分材质）`);
  } else {
    for (const [i, m] of input.materials.entries()) {
      if (!m || typeof m !== 'object') { issues.push(`materials[${i}] 必须是对象`); continue; }
      for (const key of Object.keys(m)) if (!['name', 'intent'].includes(key)) issues.push(`materials[${i}] 含未支持字段 "${key}"`);
      if (!MATERIALS.has(m.name)) issues.push(`materials[${i}].name 必须是 ${[...MATERIALS].join('/')}`);
      if (!isStr(m.intent, 160)) issues.push(`materials[${i}].intent 必须是 1–160 字符的材质意图`);
    }
  }

  // 光照
  const light = input.light;
  if (!light || typeof light !== 'object' || Array.isArray(light)) issues.push('light 必须是对象');
  else {
    for (const key of Object.keys(light)) if (!['direction', 'mood'].includes(key)) issues.push(`light 含未支持字段 "${key}"`);
    if (!isStr(light.direction, 120)) issues.push('light.direction 必须是 1–120 字符（光源方向）');
    if (!isStr(light.mood, 120)) issues.push('light.mood 必须是 1–120 字符');
  }

  if (input.interaction != null) {
    if (!Array.isArray(input.interaction) || input.interaction.length > 6 || input.interaction.some((v) => !isStr(v, 120))) {
      issues.push('interaction 必须是至多 6 项的字符串数组');
    }
  }

  // 验收条件：必须是"可核对"的陈述，不能是空泛形容词
  if (!Array.isArray(input.acceptance) || input.acceptance.length < 1 || input.acceptance.length > SCENE_BRIEF_LIMITS.maxAcceptance) {
    issues.push(`acceptance 必须是 1–${SCENE_BRIEF_LIMITS.maxAcceptance} 项`);
  } else if (input.acceptance.some((v) => !isStr(v, 180))) issues.push('acceptance 每项必须是 1–180 字符');

  if (issues.length) throw new SceneBriefError('BRIEF_INVALID', issues);
  return structuredClone(input);
}

/**
 * 交叉校验：Scene Brief 声明的东西，在真实 scene3d 节点里是否有对应证据。
 * 这一步防的是"brief 写得漂亮、scene 完全没照着做"。
 *
 * @returns {{ok: boolean, findings: Array<{code:string, severity:'blocking'|'warning', detail:string}>}}
 */
export function crossCheckBriefAgainstScene(brief, sceneNode) {
  const findings = [];
  if (!brief || !sceneNode) return { ok: false, findings: [{ code: 'BRIEF_OR_SCENE_MISSING', severity: 'blocking', detail: '缺少 brief 或 scene3d 节点' }] };
  const objects = Array.isArray(sceneNode.objects) ? sceneNode.objects : [];
  const sceneIds = new Set(objects.map((o) => o.id));

  // 1) brief 声明的对象必须真的在场景里（允许场景有 brief 未列出的装饰件，但 brief 的东西不能丢）
  const missing = (brief.objects ?? []).filter((o) => !sceneIds.has(o.id)).map((o) => o.id);
  if (missing.length) {
    findings.push({ code: 'BRIEF_OBJECT_MISSING', severity: 'blocking', detail: `brief 声明但场景缺失的对象：${missing.join('、')}` });
  }

  // 2) 主体必须存在且可选中（否则用户点不到它、档案区无从显示）
  const subjectObj = objects.find((o) => o.id === brief.subject?.id);
  if (!subjectObj) findings.push({ code: 'SUBJECT_NOT_IN_SCENE', severity: 'blocking', detail: `主体 "${brief.subject?.id}" 未出现在 scene3d 中` });
  else if (!subjectObj.selectable) findings.push({ code: 'SUBJECT_NOT_SELECTABLE', severity: 'warning', detail: `主体 "${subjectObj.id}" 未标记 selectable，用户无法选中查看档案` });

  // 3) 材质意图必须落到实际使用的材质上
  const usedMaterials = new Set(objects.map((o) => o.material));
  const declaredMaterials = new Set((brief.materials ?? []).map((m) => m.name));
  const declaredUnused = [...declaredMaterials].filter((m) => !usedMaterials.has(m));
  if (declaredUnused.length) {
    findings.push({ code: 'DECLARED_MATERIAL_UNUSED', severity: 'warning', detail: `brief 声明了材质但场景未使用：${declaredUnused.join('、')}` });
  }
  const undeclaredUsed = [...usedMaterials].filter((m) => m && !declaredMaterials.has(m));
  if (undeclaredUsed.length) {
    findings.push({ code: 'UNDECLARED_MATERIAL_USED', severity: 'warning', detail: `场景使用了 brief 未声明的材质：${undeclaredUsed.join('、')}` });
  }

  // 4) 景深层次必须真的存在（按对象 role/layer 与坐标 y 之外的信息无法判断，只看数量是否够形成层次）
  const layerSet = new Set((brief.objects ?? []).map((o) => o.layer));
  if (layerSet.size < 2) findings.push({ code: 'NO_DEPTH_LAYERS', severity: 'blocking', detail: 'brief 未形成前中后景层次' });

  // 5) 至少一个背景/中景对象是"地面类"，否则场景悬空
  const hasGroundShape = objects.some((o) => o.shape === 'terrain' || o.shape === 'island' || o.shape === 'plateau' || o.shape === 'disk');
  if (!hasGroundShape) findings.push({ code: 'NO_GROUND', severity: 'warning', detail: '场景没有地形/基座类对象（terrain/island/plateau/disk），物件可能悬空' });

  return { ok: findings.every((f) => f.severity !== 'blocking'), findings };
}
