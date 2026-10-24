/**
 * 原创像素角色 —— 完全为本项目设计，未复制任何第三方项目（如 Pixel Agents）的资产。
 * 冷色科技工作室风格：深蓝夜色基调 + 霓虹青/紫点缀。
 *
 * 通用 16x16 半身像 + 每角色配色/配件覆盖（领带、耳机、眼镜、贝雷帽、帽衫绳等）。
 * 字符含义：. 透明 / K 描边 / S 皮肤 / s 皮肤暗部 / H 头发 / C 上衣 / c 上衣暗部
 *          W 白色 / E 眼睛 / G 眼镜 / A 角色强调色
 */

export interface Pixel {
  x: number;
  y: number;
  c: string;
}

export interface RoleSpriteConfig {
  hair: string;
  cloth: string;
  clothShade: string;
  accent: string;
  /** 配件覆盖（坐标基于 16x16 网格） */
  accessory?: Pixel[];
}

const BASE = [
  '......KKKK......',
  '....KKHHHHKK....',
  '...KHHHHHHHHK...',
  '..KHHSSSSSSHHK..',
  '..KHSSSSSSSSHK..',
  '..KSSSSSSSSSSK..',
  '..KSSESSSSESSK..',
  '..KSSSSssSSSSK..',
  '...KSSSSSSSSK...',
  '.....KSSSSK.....',
  '...KCCCCCCCCK...',
  '..KCCCCCCCCCCK..',
  '..KCCCWCCWCCCK..',
  '..KCcCCCCCCcCK..',
  '..KccccccccccK..',
  '...KKKKKKKKKK...',
];

/** 眼镜配件（架构/后端共用） */
const GLASSES: Pixel[] = [
  { x: 4, y: 6, c: 'G' }, { x: 5, y: 6, c: 'G' }, { x: 6, y: 6, c: 'G' },
  { x: 9, y: 6, c: 'G' }, { x: 10, y: 6, c: 'G' }, { x: 11, y: 6, c: 'G' },
];

export const ROLE_SPRITES: Record<string, RoleSpriteConfig> = {
  supervisor: {
    hair: '#2B3350', cloth: '#3A4468', clothShade: '#2C3452', accent: '#FF5470',
    accessory: [ // 领带
      { x: 7, y: 11, c: 'A' }, { x: 8, y: 12, c: 'A' }, { x: 7, y: 13, c: 'A' },
    ],
  },
  product: {
    hair: '#6B4A2F', cloth: '#3FA79E', clothShade: '#2F837C', accent: '#00F5D4',
    accessory: [ // 头戴耳机 + 麦克风
      { x: 5, y: 1, c: 'A' }, { x: 6, y: 1, c: 'A' }, { x: 9, y: 1, c: 'A' }, { x: 10, y: 1, c: 'A' },
      { x: 4, y: 2, c: 'A' }, { x: 11, y: 2, c: 'A' }, { x: 11, y: 3, c: 'A' }, { x: 12, y: 6, c: 'A' }, { x: 11, y: 7, c: 'A' },
    ],
  },
  architect: {
    hair: '#1E2233', cloth: '#4A7FB5', clothShade: '#3A6592', accent: '#9DF5E2',
    accessory: GLASSES,
  },
  designer: {
    hair: '#4A3B5C', cloth: '#7C6BAF', clothShade: '#63548F', accent: '#E86FA4',
    accessory: [ // 贝雷帽
      { x: 5, y: 0, c: 'A' }, { x: 6, y: 0, c: 'A' }, { x: 7, y: 0, c: 'A' }, { x: 8, y: 0, c: 'A' }, { x: 9, y: 0, c: 'A' },
      { x: 4, y: 1, c: 'A' }, { x: 11, y: 1, c: 'A' },
    ],
  },
  frontend: {
    hair: '#C46A2B', cloth: '#2FA8C4', clothShade: '#2486A0', accent: '#00F5D4',
    accessory: [ // 帽衫抽绳
      { x: 6, y: 12, c: 'A' }, { x: 9, y: 12, c: 'A' },
    ],
  },
  backend: {
    hair: '#23283E', cloth: '#8B7BD8', clothShade: '#6E60B0', accent: '#7CFC9A',
    accessory: GLASSES,
  },
  tester: {
    hair: '#4A3320', cloth: '#E0A458', clothShade: '#B8823F', accent: '#FFB000',
    accessory: [ // 棒球帽 + 帽檐
      { x: 5, y: 0, c: 'A' }, { x: 6, y: 0, c: 'A' }, { x: 7, y: 0, c: 'A' }, { x: 8, y: 0, c: 'A' }, { x: 9, y: 0, c: 'A' }, { x: 10, y: 0, c: 'A' },
      { x: 4, y: 1, c: 'A' }, { x: 5, y: 1, c: 'A' }, { x: 10, y: 1, c: 'A' }, { x: 11, y: 1, c: 'A' },
      { x: 3, y: 2, c: 'A' },
    ],
  },
  reviewer: {
    hair: '#8A93A8', cloth: '#5A6B8C', clothShade: '#46546F', accent: '#FFD166',
    accessory: [ // 工牌挂绳
      { x: 7, y: 11, c: 'A' }, { x: 8, y: 11, c: 'A' }, { x: 7, y: 12, c: 'A' }, { x: 8, y: 12, c: 'W' }, { x: 7, y: 13, c: 'A' },
    ],
  },
  docs: {
    hair: '#3E4A3D', cloth: '#B8A47E', clothShade: '#94835F', accent: '#FFE9A8',
    accessory: [ // 发髻 + 胸前笔记本
      { x: 3, y: 1, c: 'H' }, { x: 12, y: 1, c: 'H' },
      { x: 6, y: 12, c: 'W' }, { x: 7, y: 12, c: 'W' }, { x: 8, y: 12, c: 'W' }, { x: 9, y: 12, c: 'W' },
    ],
  },
};

export type Pose = 'idle' | 'blink' | 'working' | 'thinking' | 'handUp';

/** 姿势补丁：眨眼 / 举手 */
const POSE_PATCH: Partial<Record<Pose, Pixel[]>> = {
  blink: [{ x: 5, y: 6, c: 's' }, { x: 10, y: 6, c: 's' }],
  handUp: [ // 举右手（等待审核）
    { x: 14, y: 8, c: 'S' }, { x: 14, y: 7, c: 'S' }, { x: 13, y: 6, c: 'S' },
    { x: 14, y: 9, c: 'C' }, { x: 13, y: 10, c: 'C' },
  ],
  thinking: [ // 托腮思考
    { x: 12, y: 8, c: 'S' }, { x: 11, y: 7, c: 'S' }, { x: 12, y: 9, c: '#D9A87C' },
    { x: 11, y: 10, c: 'C' }, { x: 10, y: 10, c: 'C' },
  ],
};

/** 解析为 [row][col] 颜色网格（16x16），可直接绘制 */
export function resolveSprite(role: string, pose: Pose): (string | null)[][] {
  const cfg = ROLE_SPRITES[role] ?? ROLE_SPRITES.supervisor!;
  const grid: (string | null)[][] = BASE.map((row) => [...row].map((ch) => {
    switch (ch) {
      case 'K': return '#0B0E1F';
      case 'S': return '#F2C9A0';
      case 's': return '#D9A87C';
      case 'H': return cfg.hair;
      case 'C': return cfg.cloth;
      case 'c': return cfg.clothShade;
      case 'W': return '#E8ECF5';
      case 'E': return '#0B0E1F';
      case 'G': return cfg.accent;
      case 'A': return cfg.accent;
      default: return null;
    }
  }));
  const apply = (px: Pixel) => {
    const ch = px.c;
    const color = ch === 'A' ? cfg.accent : ch === 'H' ? cfg.hair
      : ch === 'C' ? cfg.cloth : ch === 'W' ? '#E8ECF5' : ch === 'S' ? '#F2C9A0' : ch;
    if (grid[px.y] && px.x >= 0 && px.x < 16) grid[px.y]![px.x] = color;
  };
  for (const p of cfg.accessory ?? []) apply(p);
  for (const p of POSE_PATCH[pose] ?? []) apply(p);
  return grid;
}
