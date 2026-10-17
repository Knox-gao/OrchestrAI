import { useEffect, useRef, useState } from 'react';
import { AGENT_ROLES, type AgentRole, type ProjectState } from '@studio/core';
import { OFFICE_H, OFFICE_W, agentHitTest } from '../pixart/office';
import { drawOffice, type OfficeView } from '../pixart/render';

export function PixelOffice({
  state, selectedAgent, onSelectAgent,
}: {
  state: ProjectState;
  selectedAgent: AgentRole | null;
  onSelectAgent: (role: AgentRole) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef(state);
  const selRef = useRef(selectedAgent);
  const hoverRef = useRef<AgentRole | undefined>(undefined);
  const viewRef = useRef<OfficeView>({ k: 1, offX: 0, offY: 0 });
  const [hoverName, setHoverName] = useState<string | null>(null);
  stateRef.current = state;
  selRef.current = selectedAgent;

  // 像素完美渲染：画布背板 = 显示尺寸 × DPR，办公室按整数倍 k 居中绘制
  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, wrap.clientWidth);
      const h = Math.max(1, wrap.clientHeight);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const k = Math.max(1, Math.floor(Math.min(canvas.width / OFFICE_W, canvas.height / OFFICE_H)));
      viewRef.current = {
        k,
        offX: (canvas.width - OFFICE_W * k) / k / 2,
        offY: (canvas.height - OFFICE_H * k) / k / 2,
      };
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    const loop = (t: number) => {
      const s = stateRef.current;
      const agents = AGENT_ROLES.map((role) => ({
        role,
        status: s.agents[role]?.status ?? 'idle',
        detail: s.agents[role]?.detail,
        taskId: s.agents[role]?.currentTaskId,
        selected: selRef.current === role,
      }));
      drawOffice(ctx, t, agents, hoverRef.current, viewRef.current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  /** 屏幕 CSS 坐标 → 办公室逻辑坐标（与渲染用的视图参数一致） */
  const toInternal = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const dpr = e.currentTarget.width / rect.width;
    const { k, offX, offY } = viewRef.current;
    return {
      x: (e.clientX - rect.left) * dpr / k - offX,
      y: (e.clientY - rect.top) * dpr / k - offY,
    };
  };

  return (
    <section className="office-wrap">
      <div className="office-head">
        <span>像素办公室 · 点击角色查看详情</span>
        <div className="legend">
          <span style={{ color: 'var(--cyan)' }}>工作中</span>
          <span style={{ color: 'var(--green)' }}>测试</span>
          <span style={{ color: 'var(--yellow)' }}>待审核</span>
          <span style={{ color: 'var(--amber)' }}>阻塞</span>
          <span style={{ color: 'var(--red)' }}>失败</span>
        </div>
      </div>
      <div className="office-body" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="office"
          onMouseMove={(e) => {
            const { x, y } = toInternal(e);
            const hit = agentHitTest(x, y);
            hoverRef.current = hit;
            setHoverName(hit ? hit : null);
            e.currentTarget.style.cursor = hit ? 'pointer' : 'default';
          }}
          onMouseLeave={() => { hoverRef.current = undefined; setHoverName(null); }}
          onClick={(e) => {
            const { x, y } = toInternal(e);
            const hit = agentHitTest(x, y);
            if (hit) onSelectAgent(hit);
          }}
        />
      </div>
      <div className="office-hint">
        {hoverName
          ? `${hoverName} — 状态由后端事件驱动`
          : '动画只是状态的可视化 · 权威状态来自事件日志'}
      </div>
    </section>
  );
}
