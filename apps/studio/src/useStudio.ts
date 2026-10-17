/**
 * UI 与引擎的桥：UI 只订阅引擎状态，不持有私有业务状态（计划 3.2）。
 * 统一管理项目生命周期：新建（真实生成）/ 进入历史项目（瞬时恢复）/ 演示剧本。
 */
import { useEffect, useReducer, useState } from 'react';
import {
  StudioEngine, createDemoScenario, DEMO_CHANGE_HINT,
  type Cue, type Scenario,
} from '@studio/core';

/** 驱动引擎虚拟时钟（rAF 主循环，防后台巨帧） */
export function useEngineLoop(engine: StudioEngine | null) {
  useEffect(() => {
    if (!engine) return;
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(t - last, 250);
      last = t;
      engine.tick(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [engine]);
}

const emptyScenario: Scenario = {
  boot: () => [],
  onApproval: () => [],
  onChange: () => [],
};

export function useStudioApp() {
  const [engine, setEngine] = useState<StudioEngine | null>(null);
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => (engine ? engine.subscribe(force) : undefined), [engine]);
  useEngineLoop(engine);

  return {
    engine,
    /** 观看演示剧本（模拟多 Agent 全流程） */
    startDemo: () => {
      const e = new StudioEngine(createDemoScenario());
      setEngine(e);
      e.start();
    },
    /** 播放真实流水线事件（新引擎承载：每次生成是服务器上的新项目） */
    playInNew: (cues: Cue[]) => {
      const e = new StudioEngine(emptyScenario, { speed: 2 });
      setEngine(e);
      e.play(cues);
    },
    /** 进入历史项目：事件队列瞬时恢复终态 */
    enterProject: (cues: Cue[]) => {
      const e = new StudioEngine(emptyScenario);
      e.restoreSync(cues);
      setEngine(e);
    },
    close: () => setEngine(null),
  };
}

/** 真实生成：POST 一句话（可带风格 id）→ 服务端真实流水线 → 返回事件队列与预览地址 */
export interface GenerateResult {
  projectId: string;
  cues: Cue[];
  previewUrl: string | null;
  workspace: string;
  failed?: boolean;
}

export interface StyleEntry { id: string; name: string; base: string; palette: string }

export async function fetchStyles(): Promise<{ count: number; styles: StyleEntry[] }> {
  const res = await fetch('/api/styles');
  if (!res.ok) throw new Error('风格目录加载失败');
  return res.json();
}

export async function generateApp(
  requirement: string, style?: string, fx?: string, name?: string,
  styleDescription?: string, onPhase?: (phase: string, elapsedMs: number) => void,
  model = 'auto',
): Promise<GenerateResult> {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requirement, ...(name ? { name } : {}), ...(style ? { style } : {}),
      ...(fx ? { fx } : {}), ...(styleDescription ? { styleDescription } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`创建任务失败（${res.status}）${text.slice(0, 120)}`);
  }
  const { jobId } = (await res.json()) as { jobId: string };
  // 轮询任务阶段（消除"卡住"感；回放可随时用顶栏 ⏸ 暂停）
  for (;;) {
    await new Promise((r) => setTimeout(r, 600));
    const jr = await fetch(`/api/jobs/${jobId}`);
    if (!jr.ok) throw new Error(`任务查询失败（${jr.status}）`);
    const job = await jr.json();
    if (job.status === 'error') throw new Error(job.error ?? '生成失败');
    onPhase?.(job.phase ?? '处理中…', job.elapsedMs ?? 0);
    if (job.status === 'done') return job.result as GenerateResult;
  }
}

export interface ProjectMeta {
  id: string;
  name: string;
  sentence: string;
  type: string;
  typeName: string;
  createdAt: number;
  delivered: boolean;
  deliveryVersion: string | null;
  testSummary: string;
  previewUrl: string | null;
  fileCount: number;
  hadDefectFix: boolean;
  galleryQuery?: string | null;
  imageProvider?: string | null;
  imageCount?: number;
  styleId?: string | null;
  styleName?: string | null;
  fxLevel?: string | null;
  styleDescription?: string | null;
}

export async function fetchProjects(): Promise<ProjectMeta[]> {
  const res = await fetch('/api/projects');
  if (!res.ok) throw new Error(`项目列表加载失败（${res.status}）`);
  return res.json();
}

export async function fetchProject(id: string): Promise<{ meta: ProjectMeta; cues: Cue[] }> {
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`项目加载失败（${res.status}）`);
  return res.json();
}

export function fmtClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export { DEMO_CHANGE_HINT };
