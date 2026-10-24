/**
 * 办公室渲染器：把 AgentState（权威事件状态的投影）绘制成像素办公室。
 * 计划 3.2：动画只是状态的可视化 —— 每个 Agent 的画面完全由 status 决定。
 *
 * 画质：外部传入整数倍视图（k, offX, offY），配合 devicePixelRatio 实现像素完美渲染；
 * 所有绘制仍使用 480x270 逻辑坐标。
 */
import type { AgentRole, AgentVisualStatus } from '@studio/core';
import { DESKS, OFFICE_H, OFFICE_W, ROLE_LABEL_SHORT, SCALE, drawDesk, drawIcon, drawScene, type IconName } from './office';
import { resolveSprite, type Pose } from './sprites';

export interface AgentView {
  role: AgentRole;
  status: AgentVisualStatus;
  detail?: string;
  taskId?: string;
  selected: boolean;
}

/** 整数倍视图：k = 缩放倍数，offX/offY = 逻辑坐标下的居中偏移 */
export interface OfficeView { k: number; offX: number; offY: number }

export const DEFAULT_VIEW: OfficeView = { k: 1, offX: 0, offY: 0 };

const STATUS_COLOR: Record<AgentVisualStatus, string> = {
  idle: '#5A6B8C',
  analyzing: '#00F5D4',
  working: '#9DF5E2',
  testing: '#7CFC9A',
  awaiting_review: '#FFD166',
  blocked: '#FFB000',
  failed: '#FF5470',
};

const STATUS_STYLE: Record<AgentVisualStatus, { bubble: string | null; icon: IconName; screen: string | null; pose: Pose; bob: boolean }> = {
  idle:           { bubble: null,      icon: 'dots',     screen: null,      pose: 'idle',    bob: false },
  analyzing:      { bubble: '#00F5D4', icon: 'dots',     screen: '#00F5D4', pose: 'thinking', bob: true },
  working:        { bubble: '#9DF5E2', icon: 'keyboard', screen: '#00F5D4', pose: 'working', bob: true },
  testing:        { bubble: '#7CFC9A', icon: 'magnifier', screen: '#7CFC9A', pose: 'working', bob: true },
  awaiting_review:{ bubble: '#FFD166', icon: 'check',    screen: '#FFD166', pose: 'handUp',  bob: false },
  blocked:        { bubble: '#FFB000', icon: 'question', screen: '#FFB000', pose: 'idle',    bob: false },
  failed:         { bubble: '#FF5470', icon: 'cross',    screen: '#FF5470', pose: 'idle',    bob: false },
};

const BLINK_CYCLE = 24; // 每 24 帧眨一次眼

function drawSprite(ctx: CanvasRenderingContext2D, role: AgentRole, pose: Pose, blink: boolean, x: number, y: number) {
  const grid = resolveSprite(role, blink ? 'blink' : pose);
  // handUp 姿势需要和 blink 兼容：blink 只覆盖眼睛，直接二选一足够
  for (let r = 0; r < 16; r++) {
    for (let c = 0; c < 16; c++) {
      const color = grid[r]![c]!;
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x + c * SCALE, y + r * SCALE, SCALE, SCALE);
    }
  }
}

function drawBubble(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, icon: IconName, frame: number) {
  const w = 22, h = 17;
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.fillStyle = '#0B0E1F';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.restore();
  ctx.fillStyle = '#151B36';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x + 0.25, y + 0.25, w - 0.5, h - 0.5);
  // 气泡尾巴
  ctx.fillStyle = '#151B36';
  ctx.fillRect(x + 5, y + h, 4, 3);
  drawIcon(ctx, icon, x + 5, y + 4, color, Math.floor(frame / 4));
}

export function drawOffice(
  ctx: CanvasRenderingContext2D,
  timeMs: number,
  agents: AgentView[],
  hoverRole?: AgentRole,
  view: OfficeView = DEFAULT_VIEW,
) {
  const frame = Math.floor(timeMs / 125); // 8fps 像素节奏
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0F1226';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  // 整数倍缩放 + 居中：像素完美渲染（每个逻辑像素 = k 个设备像素）
  const { k, offX, offY } = view;
  ctx.setTransform(k, 0, 0, k, offX * k, offY * k);
  drawScene(ctx, frame);

  for (const a of agents) {
    const d = DESKS[a.role];
    if (!d) continue;
    const style = STATUS_STYLE[a.status];
    const bobY = style.bob ? (frame % 2 === 0 ? 0 : -1) * SCALE : 0;
    const blink = frame % BLINK_CYCLE >= BLINK_CYCLE - 2;

    // 工位与屏幕
    drawDesk(ctx, d, style.screen, frame, style.bob);

    // 选中/悬停光圈
    if (a.selected || hoverRole === a.role) {
      ctx.save();
      ctx.strokeStyle = a.selected ? '#00F5D4' : 'rgba(0,245,212,0.45)';
      ctx.lineWidth = 1;
      ctx.setLineDash(a.selected ? [] : [3, 3]);
      ctx.strokeRect(d.agent.x - 5 + 0.5, d.agent.y - 5 + 0.5, 16 * SCALE + 10, 16 * SCALE + 10);
      ctx.restore();
    }

    // 角色（呼吸位移 + 眨眼）
    drawSprite(ctx, a.role, style.pose, blink, d.agent.x, d.agent.y + bobY);

    // 状态气泡（头顶，失败/阻塞呼吸闪烁）
    if (style.bubble) {
      const pulse = a.status === 'blocked' || a.status === 'failed' ? Math.floor(frame / 2) % 2 === 0 : true;
      if (pulse) {
        drawBubble(ctx, d.agent.x + 16 * SCALE - 8, d.agent.y - 22, style.bubble, style.icon, frame);
      }
    }

    // 名牌：角色 + 状态灯 + 当前任务号（办公室 ↔ 看板 直接对应）
    const label = ROLE_LABEL_SHORT[a.role];
    const taskTxt = a.taskId ? `·${a.taskId}` : '';
    const plateW = 10 + (label.length + taskTxt.length) * 5;
    const px = d.desk.x + d.desk.w / 2 - plateW / 2;
    const py = d.desk.y + d.desk.h + 3;
    ctx.fillStyle = a.selected ? 'rgba(0,245,212,0.15)' : 'rgba(11,14,31,0.85)';
    ctx.fillRect(px, py, plateW, 9);
    ctx.strokeStyle = a.selected ? '#00F5D4' : '#232848';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(px + 0.25, py + 0.25, plateW - 0.5, 8.5);
    // 状态灯
    const led = STATUS_COLOR[a.status];
    ctx.fillStyle = led;
    if (a.status !== 'idle') {
      ctx.save();
      ctx.shadowColor = led;
      ctx.shadowBlur = 4;
      ctx.fillRect(px + 3, py + 3, 3, 3);
      ctx.restore();
    } else {
      ctx.fillRect(px + 3, py + 3, 3, 3);
    }
    ctx.font = '7px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = a.selected ? '#00F5D4' : '#8A93A8';
    ctx.fillText(label, px + 8, py + 6.5);
    if (taskTxt) {
      ctx.fillStyle = '#C9D4E8';
      ctx.fillText(taskTxt, px + 8 + label.length * 5, py + 6.5);
    }
  }

  // 暗角 + 极轻扫描线：提升整体质感（不牺牲清晰度）
  const vg = ctx.createRadialGradient(OFFICE_W / 2, OFFICE_H / 2, 120, OFFICE_W / 2, OFFICE_H / 2, 320);
  vg.addColorStop(0, 'rgba(5,8,20,0)');
  vg.addColorStop(1, 'rgba(5,8,20,0.38)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, OFFICE_W, OFFICE_H);
  ctx.fillStyle = 'rgba(0,0,0,0.05)';
  for (let sy = 0; sy < OFFICE_H; sy += 3) ctx.fillRect(0, sy, OFFICE_W, 1);
}

export { OFFICE_W, OFFICE_H };
