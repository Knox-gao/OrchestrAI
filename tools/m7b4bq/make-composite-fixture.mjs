#!/usr/bin/env node
/**
 * 生成"复合模型"版本的质量夹具：使用 terrain / plateau / house / lighthouse / tree / shrub / rock / dock。
 * 这是对候选包 fixture 的能力升级演示，不是为单一 fixture 硬编码 ——
 * 所有形状都是应用内置的通用复合原语，模型只填白名单参数。
 */
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2] || 'examples/island-pageplan-composite.json';

const water = {
  id: 'lagoon', name: '潟湖水面', shape: 'disk', position: [0, -0.30, 0], scale: [11.6, 0.05, 9.4],
  rotation: [0, 0, 0], color: '#8ad9ea', material: 'water',
  description: '环绕岛屿的浅色潟湖，拖动潮位滑块可改变水位。', selectable: true, motion: 'tide',
};
const base = {
  id: 'diorama-base', name: '地层底座', shape: 'plateau', position: [0, -0.95, 0], scale: [12.6, 1.0, 10.2],
  rotation: [0, 0, 0], color: '#d9c6b4', material: 'sand',
  description: '方形地层剖面：表层砂、深色沉积带与基岩，用来把岛屿"切"出来。', selectable: true, motion: 'none',
};
const terrain = {
  id: 'island-terrain', name: '果冻岛地形', shape: 'terrain', position: [0, -0.12, 0], scale: [4.5, 1.5, 3.5],
  rotation: [0, 12, 0], color: '#f2a0c6', material: 'jelly',
  description: '有体积的岛体：隆起台面、收坡岸线、浅色砂岸与深色侧壁地层。', selectable: true, motion: 'none',
};
const lighthouse = {
  id: 'lighthouse', name: '蜜糖灯塔', shape: 'lighthouse', position: [-2.15, 0.42, 0.55], scale: [0.62, 0.62, 0.62],
  rotation: [0, -18, 0], color: '#fff3dd', material: 'matte',
  description: '塔基、塔身、观景平台、灯室与暖黄灯球组成的复合灯塔。', selectable: true, motion: 'none',
};
const houseA = {
  id: 'house-a', name: '渔村主屋', shape: 'house', position: [-0.35, 0.30, 0.15], scale: [0.98, 0.86, 0.92],
  rotation: [0, 24, 0], color: '#fff0e6', material: 'jelly',
  description: '带坡屋顶、正门、三扇窗与烟囱的复合民居。', selectable: true, motion: 'none',
};
const houseB = {
  id: 'house-b', name: '温室小屋', shape: 'house', position: [0.92, 0.24, -0.62], scale: [0.82, 0.72, 0.80],
  rotation: [0, -32, 0], color: '#d6f2ec', material: 'jelly',
  description: '薄荷色的第二栋民居，屋顶与门窗同样可辨。', selectable: true, motion: 'none',
};
const tree = (i, x, z, s, color, rot) => ({
  id: `palm-${i}`, name: `棕榈 ${i}`, shape: 'tree', position: [x, 0.30, z], scale: [s, s, s],
  rotation: [0, rot, 0], color, material: 'foliage',
  description: '树干加七对放射状羽状叶的复合棕榈，不是单个绿色球体。', selectable: true, motion: 'none',
});
const shrub = (i, x, z, s, color) => ({
  id: `shrub-${i}`, name: `灌木 ${i}`, shape: 'shrub', position: [x, 0.24, z], scale: [s, s * 0.86, s],
  rotation: [0, i * 37, 0], color, material: 'foliage',
  description: '多球簇灌木。', selectable: false, motion: 'none',
});
const rock = (i, x, z, s) => ({
  id: `rock-${i}`, name: `礁岩 ${i}`, shape: 'rock', position: [x, 0.02, z], scale: [s, s * 0.8, s],
  rotation: [i * 23, i * 41, i * 11], color: '#c9a3b8', material: 'stone',
  description: '不规则多面礁岩。', selectable: false, motion: 'none',
});
const dock = {
  id: 'dock', name: '木栈桥', shape: 'dock', position: [2.85, -0.12, 1.15], scale: [1.5, 1.4, 1.4],
  rotation: [0, -26, 0], color: '#b98a77', material: 'wood',
  description: '带四根柱与横梁的木栈桥复合体。', selectable: true, motion: 'none',
};

const plan = {
  schemaVersion: 'orchestrai.pageplan.v1',
  meta: {
    title: '果冻海岛 · 复合模型版',
    description: '用复合程序化原语（地形体积 / 方形地层底座 / 房屋 / 灯塔 / 棕榈 / 灌木 / 礁岩 / 栈桥）构建的分层海岛场景。视觉质量仍须真实 Edge 截图与人工验收。',
    language: 'zh-CN',
  },
  userConstraints: { styleId: 'neumorph-blossom', fontMood: 'serif', pageDirection: 'explore', locked: true },
  designIntent: {
    concept: '把一座果冻质感的小岛切出来放进方形地层底座里：先看见整块地，再沿着路径认出灯塔、渔村、棕榈与栈桥。',
    pageDirection: 'explore',
    visualPrinciples: [
      '主体轮廓优先：方形底座 + 隆起岛体，一眼可辨是一座岛而不是球体集合',
      '前中后景：前景礁岩与栈桥、中景聚落与棕榈、后景灯塔',
      '材质分层：水/砂/地形/植被/木/石各自有不同的高光响应',
      '高光受控：不允许出现大片纯白或全灰块',
    ],
  },
  theme: {
    styleId: 'neumorph-blossom',
    background: '#f7edf1', surface: '#ffffff', text: '#15171f', muted: '#747177',
    accent: '#ce125d', accentSoft: '#f0c6d6', fontMood: 'serif', density: 'airy', radius: 'rounded',
  },
  unsupportedRequests: [],
  nodes: [
    {
      id: 'hero', type: 'section', variant: 'hero', eyebrow: 'JELLY ISLAND · MATERIAL STUDY',
      title: '果冻海岛',
      description: '一块被切出来的岛。拖拽可以绕到背面看地层剖面。',
      children: [
        { id: 'hero-text', type: 'text', text: '潮水退去时，蜜糖灯塔会先亮起来。' },
      ],
    },
    {
      id: 'scene-wrap', type: 'section', title: '三维海岛', description: '可拖拽旋转、滚轮缩放；点击物件查看档案。',
      children: [{
        id: 'island-scene', type: 'scene3d',
        label: '可交互的果冻海岛',
        description: '方形地层底座上的分层海岛：潟湖、有体积的岛体、聚落、棕榈与栈桥。',
        height: 'wide', background: '#f7edf1', groundColor: '#e6d3c4', cameraDistance: 13.5, shadows: true,
        controls: { orbit: true, zoom: true, autoRotate: false, dayNight: true, tide: true },
        objects: [
          base,
          water,
          terrain,
          lighthouse,
          houseA,
          houseB,
          tree(1, -1.85, -1.35, 1.05, '#8ecfa4', 18),
          tree(2, -1.15, -1.95, 0.92, '#a2d9ae', -24),
          tree(3, 1.95, -1.15, 1.00, '#86c9a0', 42),
          tree(4, 1.35, 0.85, 0.86, '#b3ddb4', -8),
          shrub(1, -2.35, 0.05, 0.42, '#8bc7a8'),
          shrub(2, 0.35, 1.05, 0.36, '#9bd3b8'),
          shrub(3, 2.45, -0.35, 0.40, '#8ac6a6'),
          rock(1, -4.6, 1.55, 0.55),
          rock(2, 4.15, -2.05, 0.48),
          rock(3, -3.9, -2.35, 0.42),
          dock,
        ],
      }],
    },
    {
      id: 'notes', type: 'section', title: '关于本次生成',
      children: [
        { id: 'notes-list', type: 'list', items: [
          { title: '材质是风格化高光', text: '果冻质感由受控高光与色彩压缩表现，不是物理精确折射。' },
          { title: '没有阴影贴图', text: '接触感来自聚合成片的软阴影盘，不是 shadow mapping。' },
          { title: '几何是程序化的', text: '所有物件由内置网格生成器构建，不支持导入外部 3D 模型。' },
        ] },
      ],
    },
  ],
};

fs.writeFileSync(out, JSON.stringify(plan, null, 2));
console.log('wrote', out, 'objects:', plan.nodes[1].children[0].objects.length);
