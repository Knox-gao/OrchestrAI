import type { StudioEngine } from '@studio/core';
import type { Mode } from '../App';
import { fmtClock } from '../useStudio';

const STATUS_LABEL: Record<string, string> = {
  idle: '待启动', running: '运行中', paused: '已暂停',
  awaiting_approval: '等待你的决策', awaiting_change: '等待新需求', finished: '完成',
};

export function TopBar({
  engine, mode, onHome, fallbackName, generating = false, phase, elapsedMs = 0,
}: {
  engine: StudioEngine | null; mode: Mode; onHome: () => void; fallbackName?: string;
  generating?: boolean; phase?: string | null; elapsedMs?: number;
}) {
  const s = engine?.state;
  const st = engine?.status ?? 'idle';
  const pct = s ? Math.min(100, (s.budget.spentUsd / s.budget.capUsd) * 100) : 0;

  const exportLog = () => {
    if (!engine) return;
    const blob = new Blob([JSON.stringify(engine.events, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `agent-studio-events-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <header className={`topbar ${generating ? 'is-generating' : ''}`}>
      <button className="btn home-btn" onClick={onHome} title="返回项目主页">← 主页</button>
      <div className="logo" />
      <span className="name">{s?.projectName || fallbackName || 'OrchestrAI'}</span>
      <span className={`mode-chip ${mode}`}>{mode === 'real' ? '⚡ 真实生成' : '演示剧本'}</span>
      {generating && (
        <span className="generation-phase" title={phase || '模型正在思考'}>
          <span className="generation-pulse" />
          {phase || '模型正在思考'} · {fmtClock(elapsedMs)}
        </span>
      )}
      {s?.projectName && (
        <span className="phase">
          {s.phase} · 需求 {s.currentVersion || '—'}
          {s.delivery ? ` · 交付 v${s.delivery.version}` : ''}
        </span>
      )}
      <span className={`status-pill ${st}`}>
        <span className="dot" />
        {mode === 'real' && st === 'finished' ? '生成完成' : STATUS_LABEL[st] ?? st}
      </span>

      <div className="transport">
        {mode === 'demo' && st === 'idle' && engine ? (
          <button onClick={() => engine.start()}>▶ 开始演示</button>
        ) : (
          <button
            onClick={() => engine?.resume()}
            disabled={!engine || st === 'finished' || st.startsWith('awaiting')}
          >
            {st === 'running' ? '⏸ 暂停' : '▶ 继续'}
          </button>
        )}
        {mode === 'demo' && engine && (
          <>
            <button onClick={() => engine.stepOnce()} disabled={st !== 'running' && st !== 'paused'} title="单步执行下一个事件">
              ⏭ 单步
            </button>
            <div className="speed-group">
              {[1, 2, 4].map((v) => (
                <button key={v} className={engine.speed === v ? 'active' : ''} onClick={() => engine.setSpeed(v)}>
                  {v}x
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="budget" title="模型用量成本（模拟）" style={{ opacity: s ? 1 : 0.4 }}>
        <div className="bar"><i style={{ width: `${pct}%` }} /></div>
        <span className="label">
          ${s?.budget.spentUsd.toFixed(2) ?? '0.00'} / ${s?.budget.capUsd.toFixed(2) ?? '5.00'}
          <br />
          {(((s?.budget.inputTokens ?? 0) + (s?.budget.outputTokens ?? 0)) / 1000).toFixed(1)}k tokens
        </span>
      </div>
      <button className="btn" onClick={exportLog} title="导出全部事件日志（JSON）" disabled={!engine}>
        导出日志
      </button>
      {generating && (
        <div className="generation-progress" role="progressbar" aria-label="模型生成进度" aria-valuetext={`${phase || '模型正在思考'}，已用时 ${fmtClock(elapsedMs)}`}>
          <span />
        </div>
      )}
    </header>
  );
}
