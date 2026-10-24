/**
 * 像素办公室场景 —— 原创设计（冷色科技工作室）。
 * 画布内部分辨率固定 480x270，按显示尺寸缩放渲染（image-rendering: pixelated）。
 */
import type { AgentRole } from '@studio/core';

export const OFFICE_W = 480;
export const OFFICE_H = 270;
export const WALL_H = 96;
export const SCALE = 2; // 角色 sprite 放大倍数（16x16 → 32x32）

export interface DeskDef {
  role: AgentRole;
  /** 角色头顶 sprite 左上角 */
  agent: { x: number; y: number };
  /** 桌面左上角与尺寸 */
  desk: { x: number; y: number; w: number; h: number };
  mug: string;
}

export const ROLE_LABEL_SHORT: Record<AgentRole, string> = {
  supervisor: '主管', product: '产品', architect: '架构', designer: '设计',
  frontend: '前端', backend: '后端', tester: '测试', reviewer: '审查', docs: '文档',
};

/** 工位布局：主管居中独立工位，两排各 4 工位 */
export const DESKS: Record<AgentRole, DeskDef> = {
  supervisor: { role: 'supervisor', agent: { x: 224, y: 84 }, desk: { x: 212, y: 122, w: 56, h: 22 }, mug: '#FF5470' },
  product:    { role: 'product',    agent: { x: 44, y: 130 },  desk: { x: 36, y: 168, w: 52, h: 18 }, mug: '#00F5D4' },
  architect:  { role: 'architect',  agent: { x: 152, y: 130 }, desk: { x: 144, y: 168, w: 52, h: 18 }, mug: '#9DF5E2' },
  designer:   { role: 'designer',   agent: { x: 260, y: 130 }, desk: { x: 252, y: 168, w: 52, h: 18 }, mug: '#E86FA4' },
  frontend:   { role: 'frontend',   agent: { x: 368, y: 130 }, desk: { x: 360, y: 168, w: 52, h: 18 }, mug: '#00F5D4' },
  backend:    { role: 'backend',    agent: { x: 44, y: 194 },  desk: { x: 36, y: 232, w: 52, h: 18 }, mug: '#7CFC9A' },
  tester:     { role: 'tester',     agent: { x: 152, y: 194 }, desk: { x: 144, y: 232, w: 52, h: 18 }, mug: '#FFB000' },
  reviewer:   { role: 'reviewer',   agent: { x: 260, y: 194 }, desk: { x: 252, y: 232, w: 52, h: 18 }, mug: '#FFD166' },
  docs:       { role: 'docs',       agent: { x: 368, y: 194 }, desk: { x: 360, y: 232, w: 52, h: 18 }, mug: '#FFE9A8' },
};

export function agentHitTest(x: number, y: number): AgentRole | undefined {
  for (const d of Object.values(DESKS)) {
    if (x >= d.agent.x - 4 && x <= d.agent.x + 16 * SCALE + 4 && y >= d.agent.y - 4 && y <= d.agent.y + 16 * SCALE + 10) {
      return d.role;
    }
  }
  return undefined;
}

// ---------- 状态气泡图标（7 宽的小矩阵，'#' 为图标像素） ----------

export type IconName = 'dots' | 'keyboard' | 'magnifier' | 'check' | 'bang' | 'cross' | 'question' | 'bug';

const ICONS: Record<IconName, string[]> = {
  dots: ['.......', '.......', '.......', '#. . .#', '.......', '.......'],
  keyboard: ['#######', '.#.#.#.', '#######', '.......'],
  magnifier: ['..###..', '.#...#.', '.#...#.', '..###..', '....#..', '.....#.'],
  check: ['.....#.', '....##.', '...##..', '#.##...', '.##....', '.#.....'],
  bang: ['...#...', '...#...', '...#...', '...#...', '.......', '...#...'],
  cross: ['#.....#', '.#...#.', '..#.#..', '...#...', '..#.#..', '.#...#.', '#.....#'],
  question: ['.#####.', '#.....#', '.....#.', '....#..', '...#...', '...#...', '.......'],
  bug: ['.#...#.', '..#.#..', '.#####.', '#.###.#', '.#####.', '..#.#..', '.#...#.'],
};

export function drawIcon(ctx: CanvasRenderingContext2D, name: IconName, x: number, y: number, color: string, frame = 0) {
  ctx.fillStyle = color;
  if (name === 'dots') {
    // 三颗像素按序呼吸，确保分析状态在低帧率下也能看出变化。
    const active = frame % 3;
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = i === active ? 1 : 0.28;
      ctx.fillRect(x + (1 + i * 2) * 2, y + 4, 2, 2);
    }
    ctx.globalAlpha = 1;
    return;
  }
  const rows = ICONS[name]!;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r]!.length; c++) {
      if (rows[r]![c] !== '#') continue;
      ctx.fillRect(x + c * 2, y + r * 2, 2, 2);
    }
  }
}

// ---------- 场景元素 ----------

/** 确定性伪随机（星星/天际线不闪烁） */
function rand(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function drawWindow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number) {
  ctx.fillStyle = '#0B0E1F';
  ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, '#1B2340');
  grad.addColorStop(1, '#0E1226');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
  // 星星
  ctx.fillStyle = '#8FA3D9';
  for (let i = 0; i < 14; i++) {
    const sx = x + 4 + rand(seed + i) * (w - 8);
    const sy = y + 3 + rand(seed + i * 3) * (h * 0.5);
    ctx.fillRect(Math.floor(sx), Math.floor(sy), 1, 1);
  }
  // 城市天际线
  ctx.fillStyle = '#080A18';
  let bx = x + 3;
  let bi = 0;
  while (bx < x + w - 4) {
    const bw = 4 + Math.floor(rand(seed + 50 + bi) * 6);
    const bh = 6 + Math.floor(rand(seed + 90 + bi) * 12);
    ctx.fillRect(bx, y + h - bh - 2, bw, bh);
    // 点亮几扇窗
    ctx.fillStyle = '#3D4E8C';
    for (let wy = y + h - bh; wy < y + h - 4; wy += 4) {
      if (rand(seed + bx + wy) > 0.6) ctx.fillRect(bx + 1, wy, 1, 2);
    }
    ctx.fillStyle = '#080A18';
    bx += bw + 2;
    bi++;
  }
  // 窗框
  ctx.fillStyle = '#0B0E1F';
  ctx.fillRect(x + w / 2 - 1, y, 2, h);
  ctx.fillRect(x, y + h / 2 - 1, w, 2);
}

function drawWhiteboard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = '#0B0E1F';
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = '#C9D4E8';
  ctx.fillRect(x, y, w, h);
  // 任务图草稿：小方块 + 连线
  const boxes = [
    { bx: x + 6, by: y + 6, c: '#7CFC9A' },
    { bx: x + 24, by: y + 6, c: '#00F5D4' },
    { bx: x + 42, by: y + 6, c: '#9D4EDD' },
    { bx: x + 24, by: y + 22, c: '#FFB000' },
  ];
  ctx.fillStyle = '#5A6B8C';
  ctx.fillRect(x + 12, y + 9, 12, 1);
  ctx.fillRect(x + 30, y + 9, 12, 1);
  ctx.fillRect(x + 27, y + 13, 1, 9);
  for (const b of boxes) {
    ctx.fillStyle = b.c;
    ctx.fillRect(b.bx, b.by, 7, 6);
  }
  ctx.fillStyle = '#8A93A8';
  ctx.fillRect(x + 6, y + 33, w - 12, 1);
  ctx.fillRect(x + 6, y + 37, w - 30, 1);
}

function drawServerRack(ctx: CanvasRenderingContext2D, x: number, y: number, frame: number) {
  ctx.fillStyle = '#0B0E1F';
  ctx.fillRect(x, y, 26, 40);
  ctx.fillStyle = '#151A33';
  ctx.fillRect(x + 2, y + 2, 22, 36);
  for (let u = 0; u < 5; u++) {
    const uy = y + 4 + u * 7;
    ctx.fillStyle = '#1E2440';
    ctx.fillRect(x + 4, uy, 18, 5);
    // 呼吸灯（不同单元不同相位）
    const on = Math.floor(frame / 4 + u) % 3 !== 0;
    ctx.fillStyle = on ? '#00F5D4' : '#173239';
    ctx.fillRect(x + 6, uy + 1, 2, 2);
    ctx.fillStyle = (Math.floor(frame / 3 + u * 2) % 4 === 0) ? '#9D4EDD' : '#241B3F';
    ctx.fillRect(x + 10, uy + 1, 2, 2);
    ctx.fillStyle = '#2A3354';
    for (let v = 0; v < 4; v++) ctx.fillRect(x + 14 + v * 2, uy + 2, 1, 1);
  }
}

function drawPlant(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = '#232848';
  ctx.fillRect(x, y + 14, 14, 10);
  const leaves: [number, number, number, number][] = [
    [x + 4, y + 2, 6, 12], [x, y + 6, 4, 8], [x + 10, y + 6, 4, 8],
    [x + 2, y, 4, 6], [x + 9, y + 1, 4, 5],
  ];
  for (const [lx, ly, lw, lh] of leaves) {
    ctx.fillStyle = '#2E8B6E';
    ctx.fillRect(lx, ly, lw, lh);
    ctx.fillStyle = '#3FA97F';
    ctx.fillRect(lx + 1, ly + 1, Math.max(1, lw - 2), Math.max(1, lh - 4));
  }
}

export function drawDesk(ctx: CanvasRenderingContext2D, d: DeskDef, screenColor: string | null, frame: number, busy: boolean) {
  const { x, y, w, h } = d.desk;
  // 桌体
  ctx.fillStyle = '#1E2440';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#171C36';
  ctx.fillRect(x, y + 4, w, h - 4);
  ctx.fillStyle = '#2A3354';
  ctx.fillRect(x, y, w, 2);
  // 显示器
  const mx = x + w / 2 - 11;
  const my = y - 15;
  ctx.fillStyle = '#0B0E1F';
  ctx.fillRect(mx - 2, my - 2, 26, 17);
  ctx.fillStyle = '#101530';
  ctx.fillRect(mx, my, 22, 13);
  if (screenColor) {
    ctx.fillStyle = screenColor;
    ctx.globalAlpha = busy ? 0.25 + 0.15 * Math.sin(frame / 2) : 0.5;
    ctx.fillRect(mx + 1, my + 1, 20, 11);
    ctx.globalAlpha = 1;
    // 代码行闪烁
    ctx.fillStyle = screenColor;
    for (let r = 0; r < 4; r++) {
      if (!busy && r > 1) break;
      const rowW = 6 + Math.floor(rand(frame + r * 7 + x) * 12);
      ctx.globalAlpha = 0.7;
      ctx.fillRect(mx + 2, my + 2 + r * 3, Math.min(rowW, 18), 1);
      ctx.globalAlpha = 1;
    }
  }
  // 键盘 + 马克杯
  ctx.fillStyle = '#2A3354';
  ctx.fillRect(x + w / 2 - 6, y + 2, 12, 3);
  ctx.fillStyle = d.mug;
  ctx.fillRect(x + w - 12, y - 4, 5, 6);
  ctx.fillStyle = '#0B0E1F';
  ctx.fillRect(x + w - 7, y - 3, 2, 1);
}

/** 整体场景背景（墙/地板/固定物） */
export function drawScene(ctx: CanvasRenderingContext2D, frame: number) {
  // 墙
  const wallGrad = ctx.createLinearGradient(0, 0, 0, WALL_H);
  wallGrad.addColorStop(0, '#1A1F3D');
  wallGrad.addColorStop(1, '#131729');
  ctx.fillStyle = wallGrad;
  ctx.fillRect(0, 0, OFFICE_W, WALL_H);
  // 地板
  ctx.fillStyle = '#0F1226';
  ctx.fillRect(0, WALL_H, OFFICE_W, OFFICE_H - WALL_H);
  ctx.fillStyle = '#161B36';
  for (let gx = 0; gx < OFFICE_W; gx += 24) ctx.fillRect(gx, WALL_H, 1, OFFICE_H - WALL_H);
  for (let gy = WALL_H; gy < OFFICE_H; gy += 22) ctx.fillRect(0, gy, OFFICE_W, 1);

  // 霓虹灯带（墙脚）
  ctx.save();
  ctx.shadowColor = '#00F5D4';
  ctx.shadowBlur = 8;
  ctx.fillStyle = '#00F5D4';
  ctx.fillRect(0, WALL_H - 2, OFFICE_W, 2);
  ctx.restore();

  // 霓虹招牌
  ctx.save();
  ctx.font = 'bold 11px "Courier New", monospace';
  ctx.shadowColor = '#00F5D4';
  ctx.shadowBlur = 10;
  ctx.fillStyle = '#B8FFF2';
  ctx.fillText('AGENT·STUDIO', 18, 26);
  ctx.shadowBlur = 6;
  ctx.shadowColor = '#9D4EDD';
  ctx.fillStyle = '#9D4EDD';
  ctx.fillRect(18, 30, 86, 1);
  ctx.restore();

  // 窗户（夜色城市）
  drawWindow(ctx, 128, 14, 60, 44, 7);
  drawWindow(ctx, 296, 14, 60, 44, 13);
  // 白板（任务图）
  drawWhiteboard(ctx, 204, 18, 72, 44);
  // 服务器机架
  drawServerRack(ctx, 12, 52, frame);
  // 挂钟
  ctx.fillStyle = '#0B0E1F';
  ctx.fillRect(92, 56, 16, 16);
  ctx.fillStyle = '#C9D4E8';
  ctx.fillRect(94, 58, 12, 12);
  ctx.fillStyle = '#0B0E1F';
  ctx.fillRect(99, 60, 1, 5);
  ctx.fillRect(100, 64, 4, 1);
  // 地毯（主管工位）
  ctx.fillStyle = '#1A1545';
  ctx.fillRect(190, 116, 100, 42);
  ctx.strokeStyle = 'rgba(157,78,221,0.4)';
  ctx.strokeRect(190.5, 116.5, 99, 41);
  // 绿植
  drawPlant(ctx, 440, 150);
  drawPlant(ctx, 6, 150);
}
