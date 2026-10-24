#!/usr/bin/env node
/**
 * M7-B4C：三个主题的 ScenePlan 生成器（用于 Stub 全链验证 + 真实模型入口的对照基准）
 *
 * 这三个计划是**手写的 Stub 期望输出**，用来验证：
 *   - schema 能接受带 sceneBrief 的计划
 *   - 渲染器/检查器对三个不同主题都成立
 *   - 不是"所有主题都套岛屿模板"
 *
 * 它们的角色是"Stub 响应"，不是"已验证的模型能力"。真实模型能力必须另行验收。
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || 'examples/m7b4c-themes';
fs.mkdirSync(OUT, { recursive: true });

const theme = {
  styleId: 'neumorph-blossom', background: '#f7edf1', surface: '#ffffff', text: '#15171f', muted: '#747177',
  accent: '#ce125d', accentSoft: '#f0c6d6', fontMood: 'serif', density: 'airy', radius: 'rounded',
};

const pageShell = (title, description, brief, sceneNode, extraSections = []) => ({
  schemaVersion: 'orchestrai.pageplan.v1',
  meta: { title, description, language: 'zh-CN' },
  userConstraints: { styleId: 'neumorph-blossom', fontMood: 'serif', pageDirection: 'explore', locked: true },
  designIntent: {
    concept: brief.theme,
    pageDirection: 'explore',
    visualPrinciples: [brief.visualStyle, brief.composition.focalPoint ? `焦点：${brief.composition.focalPoint}` : '焦点明确'].filter(Boolean),
  },
  theme,
  sceneBrief: brief,
  nodes: [
    { id: 'hero', type: 'section', variant: 'hero', eyebrow: brief.theme, title, description, children: [
      { id: 'hero-text', type: 'text', text: brief.subject.description },
    ] },
    { id: 'scene-section', type: 'section', title: '三维场景', description: '拖拽旋转、滚轮缩放；点击物件查看档案。', children: [sceneNode] },
    ...extraSections,
  ],
  unsupportedRequests: [],
});

// ============ 主题 1：热带海岛 diorama ============
const islandBrief = {
  schemaVersion: 'orchestrai.scene-brief.v1',
  theme: '果冻质感的热带小岛',
  visualStyle: '粉色新拟物，柔和高光，编辑式留白',
  subject: { id: 'island-terrain', description: '有厚度与地层剖面的果冻岛体', silhouette: '隆起台面 + 不规则海岸 + 可见侧壁地层' },
  secondaryFocus: ['蜜糖灯塔', '棕榈群', '木栈桥'],
  composition: { cameraAngle: 'isometric', subjectCoverage: [0.4, 0.6], whitespace: 'airy', focalPoint: '蜜糖灯塔' },
  terrain: { kind: '方形地层底座', relief: 'rolling', layers: ['浅水潟湖', '砂岸带', '珊瑚沉积层', '深色基岩'] },
  objects: [
    { id: 'island-plateau', role: 'accent', scaleHint: 'huge', layer: 'background', relation: '作为整块地台的基底' },
    { id: 'island-lagoon', role: 'secondary', scaleHint: 'huge', layer: 'background', relation: '环绕岛体的浅水潟湖' },
    { id: 'island-terrain', role: 'subject', scaleHint: 'large', layer: 'midground', relation: '居中隆起，占据画面主体' },
    { id: 'island-lighthouse', role: 'secondary', scaleHint: 'small', layer: 'background', relation: '岛体西侧高地，作为视觉焦点' },
    { id: 'island-house', role: 'secondary', scaleHint: 'small', layer: 'midground', relation: '岛体中部偏东的聚落' },
    { id: 'island-palm-a', role: 'accent', scaleHint: 'medium', layer: 'midground', relation: '岛体北侧成组棕榈' },
    { id: 'island-palm-b', role: 'accent', scaleHint: 'medium', layer: 'background', relation: '岛体东北侧棕榈' },
    { id: 'island-dock', role: 'accent', scaleHint: 'small', layer: 'foreground', relation: '从岛体东南伸入水面' },
    { id: 'island-rock', role: 'accent', scaleHint: 'tiny', layer: 'foreground', relation: '画面左下水面上的礁石' },
  ],
  materials: [
    { name: 'jelly', intent: '岛体半透果冻质感' },
    { name: 'water', intent: '潟湖分层水色' },
    { name: 'sand', intent: '底座砂层与地层剖面' },
    { name: 'foliage', intent: '棕榈羽叶哑光绿' },
    { name: 'wood', intent: '栈桥暖棕木料' },
    { name: 'stone', intent: '礁石冷灰粗糙' },
    { name: 'matte', intent: '灯塔塔身哑光米白' },
  ],
  light: { direction: '左上前方主光，右下弱补光', mood: '柔和、高光克制' },
  interaction: ['拖拽旋转', '点击物件查看档案', '昼夜切换', '潮位调整'],
  acceptance: ['主体占画幅 40–60%', '至少三层景深都有物件', '水面能看出深浅层次', '灯塔可点选并有档案'],
};
const islandScene = {
  id: 'island-scene', type: 'scene3d', label: '果冻海岛', description: '方形地层底座上的分层海岛。',
  height: 'wide', background: '#f7edf1', groundColor: '#e6d3c4', cameraDistance: 13.5, shadows: true,
  controls: { orbit: true, zoom: true, autoRotate: false, dayNight: true, tide: true },
  objects: [
    { id: 'island-plateau', name: '地层底座', shape: 'plateau', position: [0, -1.16, 0], scale: [12.6, 1.5, 10.2], rotation: [0, 0, 0], color: '#d9c6b4', material: 'sand', description: '方形地层剖面。', selectable: true, motion: 'none' },
    { id: 'island-lagoon', name: '潟湖', shape: 'lagoon', position: [0, -0.62, 0], scale: [11.4, 0.06, 9.2], rotation: [0, 0, 0], color: '#8ad9ea', material: 'water', description: '分层水面。', selectable: true, motion: 'none' },
    { id: 'island-terrain', name: '岛体', shape: 'terrain', position: [0, -0.30, 0], scale: [4.6, 1.55, 3.6], rotation: [0, 12, 0], color: '#f2a0c6', material: 'jelly', description: '有体积的岛体地形。', selectable: true, motion: 'none' },
    { id: 'island-lighthouse', name: '蜜糖灯塔', shape: 'lighthouse', position: [-2.15, 0.42, 0.55], scale: [0.86, 0.86, 0.86], rotation: [0, -18, 0], color: '#fff3dd', material: 'matte', description: '复合灯塔。', selectable: true, motion: 'none' },
    { id: 'island-house', name: '渔村主屋', shape: 'house', position: [-0.35, 0.30, 0.15], scale: [1.3, 1.1, 1.22], rotation: [0, 24, 0], color: '#fff0e6', material: 'jelly', description: '复合民居。', selectable: true, motion: 'none' },
    { id: 'island-palm-a', name: '棕榈 A', shape: 'tree', position: [-1.85, 0.30, -1.35], scale: [1.5, 1.5, 1.5], rotation: [0, 18, 0], color: '#8ecfa4', material: 'foliage', description: '复合棕榈。', selectable: true, motion: 'none' },
    { id: 'island-palm-b', name: '棕榈 B', shape: 'tree', position: [1.95, 0.30, -1.15], scale: [1.3, 1.3, 1.3], rotation: [0, 42, 0], color: '#a2d9ae', material: 'foliage', description: '复合棕榈。', selectable: true, motion: 'none' },
    { id: 'island-dock', name: '木栈桥', shape: 'dock', position: [2.85, -0.12, 1.15], scale: [1.5, 1.4, 1.4], rotation: [0, -26, 0], color: '#b98a77', material: 'wood', description: '复合栈桥。', selectable: true, motion: 'none' },
    { id: 'island-rock', name: '礁石', shape: 'rock', position: [-3.9, 0.02, 1.55], scale: [0.6, 0.5, 0.55], rotation: [12, 34, 8], color: '#c9a3b8', material: 'stone', description: '复合礁石。', selectable: false, motion: 'none' },
  ],
};

// ============ 主题 2：非岛屿 —— 山地村庄 ============
const villageBrief = {
  schemaVersion: 'orchestrai.scene-brief.v1',
  theme: '山谷里的微缩村落',
  visualStyle: '暖砂岩色调，晨雾柔光，建筑群聚落感',
  subject: { id: 'village-hill', description: '带梯田与坡面的山丘主体', silhouette: '层层收窄的台地山丘，可见耕层剖面' },
  secondaryFocus: ['教堂钟楼', '三栋民居', '山道'],
  composition: { cameraAngle: 'high', subjectCoverage: [0.35, 0.55], whitespace: 'balanced', focalPoint: '教堂钟楼' },
  terrain: { kind: '方形切块地台', relief: 'steep', layers: ['草坡', '梯田土层', '岩基'] },
  objects: [
    { id: 'village-plinth', role: 'accent', scaleHint: 'huge', layer: 'background', relation: '承载整块山体的方形地台' },
    { id: 'village-hill', role: 'subject', scaleHint: 'large', layer: 'midground', relation: '居中偏后，形成山谷坡面' },
    { id: 'village-church', role: 'secondary', scaleHint: 'small', layer: 'background', relation: '山顶最高点，视觉焦点' },
    { id: 'village-house-a', role: 'secondary', scaleHint: 'small', layer: 'midground', relation: '半坡第一级台地' },
    { id: 'village-house-b', role: 'secondary', scaleHint: 'small', layer: 'foreground', relation: '坡脚近景' },
    { id: 'village-tree-a', role: 'accent', scaleHint: 'medium', layer: 'midground', relation: '坡面左侧成组' },
    { id: 'village-tree-b', role: 'accent', scaleHint: 'medium', layer: 'background', relation: '钟楼后方' },
    { id: 'village-path', role: 'accent', scaleHint: 'medium', layer: 'foreground', relation: '从坡脚蜿蜒上行' },
  ],
  materials: [
    { name: 'stone', intent: '山体岩层与钟楼基座' },
    { name: 'sand', intent: '地台切面与梯田土' },
    { name: 'wood', intent: '民居梁柱与山道' },
    { name: 'foliage', intent: '坡面草木' },
    { name: 'matte', intent: '墙面抹灰' },
  ],
  light: { direction: '右上后侧晨光，长影', mood: '温暖、低对比' },
  interaction: ['拖拽旋转', '点击建筑查看档案', '昼夜切换'],
  acceptance: ['山丘有明显坡面与台地层次', '钟楼是最高的可辨焦点', '建筑不是方块堆叠', '至少三层景深'],
};
const villageScene = {
  id: 'village-scene', type: 'scene3d', label: '山谷村落', description: '方形切块地台上的梯田山丘与村落。',
  height: 'wide', background: '#f6efe6', groundColor: '#d8c7ae', cameraDistance: 14, shadows: true,
  controls: { orbit: true, zoom: true, autoRotate: false, dayNight: true, tide: false },
  objects: [
    { id: 'village-plinth', name: '切块地台', shape: 'plateau', position: [0, -1.1, 0], scale: [11.5, 1.4, 9.5], rotation: [0, 0, 0], color: '#cfb99c', material: 'sand', description: '方形地层切块。', selectable: true, motion: 'none' },
    { id: 'village-hill', name: '梯田山丘', shape: 'terrain', position: [0, -0.25, -0.4], scale: [4.8, 2.1, 3.9], rotation: [0, -8, 0], color: '#b8c99a', material: 'stone', description: '有坡面与台地的山体。', selectable: true, motion: 'none' },
    { id: 'village-church', name: '教堂钟楼', shape: 'lighthouse', position: [-0.6, 1.35, -1.5], scale: [0.7, 1.05, 0.7], rotation: [0, 12, 0], color: '#f2ead9', material: 'matte', description: '钟楼（复用塔形复合体）。', selectable: true, motion: 'none' },
    { id: 'village-house-a', name: '半坡民居', shape: 'house', position: [1.1, 0.55, -0.35], scale: [1.0, 0.9, 0.95], rotation: [0, -22, 0], color: '#e8d9c2', material: 'matte', description: '复合民居。', selectable: true, motion: 'none' },
    { id: 'village-house-b', name: '坡脚民居', shape: 'house', position: [0.4, -0.15, 1.6], scale: [1.15, 1.0, 1.05], rotation: [0, 16, 0], color: '#ddc9ae', material: 'matte', description: '复合民居。', selectable: true, motion: 'none' },
    { id: 'village-tree-a', name: '坡面树 A', shape: 'tree', position: [-2.0, 0.35, 0.2], scale: [1.15, 1.15, 1.15], rotation: [0, 26, 0], color: '#7fae7a', material: 'foliage', description: '复合树。', selectable: true, motion: 'none' },
    { id: 'village-tree-b', name: '坡面树 B', shape: 'tree', position: [-0.2, 1.1, -2.0], scale: [0.95, 0.95, 0.95], rotation: [0, -34, 0], color: '#8bbd84', material: 'foliage', description: '复合树。', selectable: true, motion: 'none' },
    { id: 'village-path', name: '山道', shape: 'dock', position: [0.9, -0.35, 2.5], scale: [1.7, 0.5, 1.2], rotation: [0, 22, 0], color: '#a98a68', material: 'wood', description: '木栈道（复用复合体作山道）。', selectable: false, motion: 'none' },
  ],
};

// ============ 主题 3：自由主题（非岛非村庄）—— 沙漠温室营地 ============
const domeBrief = {
  schemaVersion: 'orchestrai.scene-brief.v1',
  theme: '沙漠中的玻璃温室营地',
  visualStyle: '沙丘暖色 + 薄荷玻璃，强方向光产生长影',
  subject: { id: 'dome-greenhouse', description: '半透明玻璃穹顶温室', silhouette: '低矮穹顶 + 可见内部结构骨架' },
  secondaryFocus: ['供水塔', '沙丘', '营地围栏'],
  composition: { cameraAngle: 'low', subjectCoverage: [0.3, 0.5], whitespace: 'airy', focalPoint: '玻璃穹顶' },
  terrain: { kind: '沙丘地形', relief: 'gentle', layers: ['风蚀沙脊', '砾石层'] },
  objects: [
    { id: 'dome-sand', role: 'accent', scaleHint: 'huge', layer: 'background', relation: '起伏沙丘作为地景' },
    { id: 'dome-greenhouse', role: 'subject', scaleHint: 'large', layer: 'midground', relation: '画面中央的穹顶' },
    { id: 'dome-tower', role: 'secondary', scaleHint: 'small', layer: 'background', relation: '穹顶右后方供水塔' },
    { id: 'dome-crate-a', role: 'accent', scaleHint: 'tiny', layer: 'foreground', relation: '左前景补给箱' },
    { id: 'dome-crate-b', role: 'accent', scaleHint: 'tiny', layer: 'foreground', relation: '右前景补给箱' },
    { id: 'dome-shrub', role: 'accent', scaleHint: 'tiny', layer: 'midground', relation: '穹顶左侧耐旱灌木' },
    { id: 'dome-rock', role: 'accent', scaleHint: 'small', layer: 'foreground', relation: '右下裸露砾岩' },
  ],
  materials: [
    { name: 'sand', intent: '沙丘细腻颗粒' },
    { name: 'jelly', intent: '玻璃穹顶半透' },
    { name: 'metal', intent: '骨架与供水塔金属' },
    { name: 'wood', intent: '补给箱木料' },
    { name: 'foliage', intent: '耐旱灌木' },
    { name: 'stone', intent: '砾岩' },
  ],
  light: { direction: '右后低角度夕阳，长投影', mood: '强对比、暖色' },
  interaction: ['拖拽旋转', '点击物件查看档案', '昼夜切换'],
  acceptance: ['穹顶轮廓可辨且是焦点', '沙丘有起伏而非平面', '前景/中景/背景都有物件', '至少 4 种可区分材质'],
};
const domeScene = {
  id: 'dome-scene', type: 'scene3d', label: '沙漠温室营地', description: '起伏沙丘中的玻璃穹顶温室。',
  height: 'wide', background: '#f7efe2', groundColor: '#d9c49a', cameraDistance: 13, shadows: true,
  controls: { orbit: true, zoom: true, autoRotate: false, dayNight: true, tide: false },
  objects: [
    { id: 'dome-sand', name: '沙丘', shape: 'terrain', position: [0, -0.35, 0], scale: [6.5, 1.1, 5.0], rotation: [0, 0, 0], color: '#e0c894', material: 'sand', description: '起伏沙丘地形。', selectable: true, motion: 'none' },
    { id: 'dome-greenhouse', name: '玻璃穹顶', shape: 'dome', position: [0, 0.55, 0], scale: [3.1, 2.4, 3.1], rotation: [0, 0, 0], color: '#a9e4de', material: 'jelly', description: '多环带半球壳 + 骨架 + 基座 + 内部植被。', selectable: true, motion: 'none' },
    { id: 'dome-tower', name: '供水塔', shape: 'lighthouse', position: [2.6, 0.55, -1.9], scale: [0.62, 0.95, 0.62], rotation: [0, 0, 0], color: '#c9bfae', material: 'metal', description: '复合塔形结构。', selectable: true, motion: 'none' },
    { id: 'dome-crate-a', name: '补给箱 A', shape: 'house', position: [-2.4, 0.05, 1.9], scale: [0.55, 0.4, 0.5], rotation: [0, 28, 0], color: '#b98a5e', material: 'wood', description: '木箱（复用复合体缩小）。', selectable: false, motion: 'none' },
    { id: 'dome-crate-b', name: '补给箱 B', shape: 'house', position: [2.0, 0.0, 2.2], scale: [0.45, 0.34, 0.42], rotation: [0, -16, 0], color: '#a97a50', material: 'wood', description: '木箱。', selectable: false, motion: 'none' },
    { id: 'dome-shrub', name: '耐旱灌木', shape: 'shrub', position: [-2.2, 0.55, -0.6], scale: [0.75, 0.62, 0.75], rotation: [0, 40, 0], color: '#8fa86a', material: 'foliage', description: '复合灌木。', selectable: true, motion: 'none' },
    { id: 'dome-rock', name: '砾岩', shape: 'rock', position: [3.1, -0.1, 1.6], scale: [0.8, 0.6, 0.7], rotation: [16, 40, 12], color: '#bfae98', material: 'stone', description: '裸露砾岩。', selectable: false, motion: 'none' },
  ],
};

const themes = {
  'island': pageShell('果冻海岛', '方形地层底座上的分层海岛 diorama。', islandBrief, islandScene, [{
    id: 'notes', type: 'section', title: '关于本次生成', children: [
      { id: 'notes-list', type: 'list', items: [
        { title: '材质是风格化高光', text: '果冻质感由受控高光表现，不是物理折射。' },
        { title: '没有阴影贴图', text: '接触感来自聚合软阴影，不是 shadow mapping。' },
      ] },
    ],
  }]),
  'village': pageShell('山谷村落', '非岛屿主题：梯田山丘上的微缩村落。', villageBrief, villageScene),
  'dome': pageShell('沙漠温室营地', '自由主题：起伏沙丘中的玻璃穹顶温室。', domeBrief, domeScene),
};

for (const [name, plan] of Object.entries(themes)) {
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(plan, null, 2));
  console.log(`wrote ${name}.json  objects=${plan.nodes.find((n) => n.type === 'section' && n.children?.[0]?.type === 'scene3d')?.children[0].objects.length ?? '?'}`);
}
