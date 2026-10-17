import { useEffect, useRef, useState } from 'react';
import {
  APPROVAL_KIND_LABELS, GATE_LABELS, ROLE_LABELS, TASK_STATUS_LABELS,
  eventText,
  type Approval, type Artifact, type ProjectState, type TestRun,
} from '@studio/core';
import { fmtClock } from '../useStudio';

export type TabKey = 'preview' | 'req' | 'task' | 'test' | 'approval' | 'change' | 'events' | 'agent';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'req', label: '需求' },
  { key: 'task', label: '任务' },
  { key: 'test', label: '测试' },
  { key: 'approval', label: '审批' },
  { key: 'change', label: '变更' },
  { key: 'events', label: '事件' },
];

export function DetailPanel({
  engine, tab, setTab, selectedTaskId, onSelectTask, selectedAgent, previewUrl,
}: {
  engine: import('@studio/core').StudioEngine;
  tab: TabKey;
  setTab: (t: TabKey) => void;
  selectedTaskId: string | null;
  onSelectTask: (id: string) => void;
  selectedAgent: import('@studio/core').AgentRole | null;
  previewUrl?: string | null;
}) {
  const s = engine.state;
  const pendingApprovals = Object.values(s.approvals).filter((a) => a.status === 'pending');
  const tabs = [...TABS];
  if (previewUrl) tabs.unshift({ key: 'preview', label: '🎉 预览' });
  if (selectedAgent) tabs.push({ key: 'agent', label: `Agent·${ROLE_LABELS[selectedAgent]}` });

  return (
    <section className="detail">
      <div className="tabs">
        {tabs.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === 'approval' && pendingApprovals.length > 0 && (
              <span className="badge">{pendingApprovals.length}</span>
            )}
          </button>
        ))}
      </div>
      <div className="detail-body preview-body">
        {tab === 'preview' && previewUrl && <PreviewView url={previewUrl} name={s.projectName} projectId={s.projectId} />}
        {tab === 'req' && <ReqView s={s} />}
        {tab === 'task' && <TaskView s={s} taskId={selectedTaskId} onOpenTest={() => setTab('test')} />}
        {tab === 'test' && <TestView s={s} />}
        {tab === 'approval' && <ApprovalView engine={engine} />}
        {tab === 'change' && <ChangeView s={s} onSelectTask={onSelectTask} openTask={() => setTab('task')} />}
        {tab === 'events' && <EventsView engine={engine} />}
        {tab === 'agent' && selectedAgent && <AgentView s={s} role={selectedAgent} onSelectTask={onSelectTask} openTask={() => setTab('task')} />}
      </div>
    </section>
  );
}

/* ---------- 预览（真实模式：生成的 App 直接可用） ---------- */
function PreviewView({ url, name, projectId }: { url: string; name: string; projectId: string }) {
  const dl = (fmt: 'zip' | 'exe' | 'apk') =>
    `/api/projects/${encodeURIComponent(projectId)}/export?fmt=${fmt}`;
  return (
    <>
      <div className="sect">
        <h4>🎉 {name || '你的 App'} · 在线预览</h4>
        <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8, lineHeight: 1.6 }}>
          这是刚从你的一句话<b>真实生成</b>的应用（文件已写入工作区，测试真实通过）。可以直接在下方使用，或
          <a href={url} target="_blank" rel="noreferrer" style={{ color: 'var(--cyan)' }}>在新标签页打开 ↗</a>。
        </p>
      </div>
      <div className="sect export-sect">
        <h4>安装与打包</h4>
        <p style={{ fontSize: 11.5, color: 'var(--text-faint)', marginBottom: 8, lineHeight: 1.7 }}>
          本应用是 PWA：浏览器菜单「安装应用」即可装进桌面/开始菜单（Windows）或主屏（Android，Chrome 会生成真正的 WebAPK）。
        </p>
        <div className="export-btns">
          <a className="btn" href={dl('exe')} title="下载 Electron 工程：npm install && npm run dist 产出 Windows .exe">📦 .exe 打包工程</a>
          <a className="btn" href={dl('apk')} title="TWA 工程 + PWA 安装指南（bubblewrap 产出 .apk）">📦 .apk 打包工程</a>
          <a className="btn" href={dl('zip')} title="完整源码 ZIP（PWA + 测试）">⬇ 完整源码 ZIP</a>
        </div>
      </div>
      <iframe
        src={url}
        title="生成的应用预览"
        className="preview-frame"
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
      />
    </>
  );
}

/* ---------- 需求 ---------- */
function ReqView({ s }: { s: ProjectState }) {
  const versions = Object.values(s.requirementVersions).sort((a, b) => b.createdAt - a.createdAt);
  if (versions.length === 0) {
    return <div className="sect"><p style={{ color: 'var(--text-faint)' }}>尚未提交需求。演示开始后，用户需求将出现在这里。</p></div>;
  }
  return (
    <>
      {versions.map((rv) => (
        <div className="sect" key={rv.id} style={{ opacity: rv.status === 'superseded' ? 0.55 : 1 }}>
          <h4>
            需求版本 {rv.version}
            {rv.status === 'confirmed' && <span className="chip green">已确认</span>}
            {rv.status === 'draft' && <span className="chip yellow">待确认</span>}
            {rv.status === 'superseded' && <span className="chip">已被 {rv.supersedes ? '新版' : ''}取代·历史保留</span>}
          </h4>
          <p style={{ marginBottom: 8, lineHeight: 1.6 }}>{rv.overview}</p>
          {rv.userStories.map((us) => (
            <div className="story" key={us.id}>
              <span className="sid">{us.id}</span> {us.story}
              <div className="accept">
                {us.acceptance.map((a, i) => <div key={i}>{a}</div>)}
              </div>
            </div>
          ))}
          <div className="sect" style={{ marginTop: 10 }}>
            <h4>假设</h4>
            {rv.assumptions.map((a, i) => <div key={i} style={{ fontSize: 12, color: 'var(--text-dim)' }}>· {a}</div>)}
          </div>
          <div className="sect">
            <h4>风险</h4>
            {rv.risks.map((a, i) => <div key={i} style={{ fontSize: 12, color: 'var(--text-dim)' }}>· {a}</div>)}
          </div>
        </div>
      ))}
      {s.delivery && (
        <div className="sect">
          <h4>最新交付 v{s.delivery.version}</h4>
          <div className="kv">
            <dt>测试</dt><dd>{s.delivery.testSummary}</dd>
            <dt>内容</dt>
            <dd>{s.delivery.manifest.map((m, i) => <div key={i} className="mono" style={{ fontSize: 11 }}>{m}</div>)}</dd>
            <dt>已知限制</dt>
            <dd>{s.delivery.knownLimits.map((m, i) => <div key={i} style={{ fontSize: 12, color: 'var(--text-dim)' }}>· {m}</div>)}</dd>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- 任务 ---------- */
function TaskView({ s, taskId, onOpenTest }: { s: ProjectState; taskId: string | null; onOpenTest: () => void }) {
  const tasks = Object.values(s.tasks);
  if (!taskId) {
    return (
      <div className="sect">
        <h4>任务图（{tasks.length} 项）</h4>
        {tasks.length === 0 && <p style={{ color: 'var(--text-faint)' }}>计划确认后，任务将在这里展开。</p>}
        {tasks.map((t) => (
          <div key={t.id} className="task-card" style={{ cursor: 'default' }}>
            <div><span className="tid">{t.id}</span><span className="title">{t.title}</span></div>
            <div className="meta"><span>{ROLE_LABELS[t.role]}</span><span>{TASK_STATUS_LABELS[t.status]}</span></div>
          </div>
        ))}
      </div>
    );
  }
  const t = s.tasks[taskId];
  if (!t) return null;
  const runs = Object.values(s.agentRuns).filter((r) => r.taskId === t.id);
  const latestRun = runs[runs.length - 1];
  const artifacts = t.artifacts.map((id) => s.artifacts[id]).filter((a): a is Artifact => !!a);
  const testRuns = t.testRuns.map((id) => s.testRuns[id]).filter(Boolean) as TestRun[];

  return (
    <>
      <div className="sect">
        <h4>任务 {t.id}{t.attempts > 1 && <span className="chip red">第 {t.attempts} 次执行</span>}</h4>
        <div className="kv">
          <dt>标题</dt><dd style={{ fontWeight: 600 }}>{t.title}</dd>
          <dt>状态</dt><dd><span className={`chip ${t.status === 'done' ? 'green' : t.status === 'blocked' ? 'amber' : 'cyan'}`}>{TASK_STATUS_LABELS[t.status]}</span></dd>
          <dt>负责人</dt><dd>{ROLE_LABELS[t.role]}</dd>
          <dt>依赖</dt><dd>{t.dependsOn.length ? t.dependsOn.join(' → ') : '无'}</dd>
          {t.blockingReason && (<><dt>阻塞原因</dt><dd style={{ color: 'var(--amber)' }}>{t.blockingReason}</dd></>)}
        </div>
      </div>
      <div className="sect">
        <h4>输出契约（完成定义）</h4>
        {t.outputs.map((o, i) => <div key={i} style={{ fontSize: 12 }}>· {o}</div>)}
      </div>
      {artifacts.length > 0 && (
        <div className="sect">
          <h4>产物（{artifacts.length}）</h4>
          {artifacts.map((a) => (
            <div key={a.id} style={{ marginBottom: 4 }}>
              <span className="mono" style={{ color: 'var(--cyan)', fontSize: 11 }}>{a.path}</span>
              <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>
                {' '}{a.summary}
                {a.linesAdded !== undefined && ` (+${a.linesAdded}/-${a.linesRemoved ?? 0})`}
              </span>
            </div>
          ))}
        </div>
      )}
      {testRuns.length > 0 && (
        <div className="sect">
          <h4>测试证据（点击「测试」看完整报告）</h4>
          {testRuns.map((tr) => (
            <div key={tr.id} className="mono" style={{ fontSize: 11, marginBottom: 2, cursor: 'pointer' }} onClick={onOpenTest}>
              <span className={`exit ${tr.exitCode === 0 ? 'ok' : 'bad'}`}>exit {tr.exitCode}</span>{' '}
              {tr.command} — {tr.passed}✓/{tr.failed}✗
            </div>
          ))}
        </div>
      )}
      <div className="sect">
        <h4>门禁记录</h4>
        {s.gates.filter((g) => g.taskId === t.id).map((g, i) => (
          <div key={i} style={{ fontSize: 12, marginBottom: 2 }}>
            <span className={g.passed ? 'chip green' : 'chip red'}>{GATE_LABELS[g.gate]}</span> {g.detail}
          </div>
        ))}
        {s.gates.filter((g) => g.taskId === t.id).length === 0 && (
          <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>暂无</span>
        )}
      </div>
      {latestRun && (
        <div className="sect">
          <h4>执行日志 · {latestRun.model.provider}/{latestRun.model.modelId}</h4>
          <div className="logbox">
            {runs.flatMap((r) => r.steps).map((step, i) => (
              <div key={i}>
                <span style={{ color: 'var(--text-faint)' }}>[{fmtClock(step.at || 0)}]</span>{' '}
                {step.tool ? `<${step.tool}> ` : ''}{step.detail}
              </div>
            ))}
            {runs.flatMap((r) => r.steps).length === 0 && <span style={{ color: 'var(--text-faint)' }}>（等待执行…）</span>}
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- 测试报告 ---------- */
function TestView({ s }: { s: ProjectState }) {
  const runs = Object.values(s.testRuns);
  return (
    <>
      <div className="sect">
        <h4>测试运行器报告（{runs.length} 次）</h4>
        <p style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 10, lineHeight: 1.6 }}>
          所有结论均来自实际执行的命令记录（命令、退出码、日志落盘）。Agent 自述不作为测试通过证据。
        </p>
      </div>
      {runs.length === 0 && <span style={{ color: 'var(--text-faint)' }}>暂无测试运行。</span>}
      {runs.map((tr) => (
        <div className="testrun" key={tr.id} style={{ opacity: tr.supersededBy ? 0.6 : 1 }}>
          <div className="tr-head">
            <span className={`exit ${tr.exitCode === 0 ? 'ok' : 'bad'}`}>exit {tr.exitCode}</span>
            <span className="chip cyan">{tr.kind}</span>
            <span className="cmd">{tr.command}</span>
            <span className="mono" style={{ fontSize: 11 }}>{tr.passed}✓ / {tr.failed}✗</span>
          </div>
          <div className="tr-body">
            <div style={{ fontSize: 12, marginBottom: 6 }}>{tr.summary}</div>
            <div className="logbox" style={{ maxHeight: 160 }}>
              {tr.logExcerpt.map((line, i) => (
                <div key={i} className={line.startsWith('✗') ? 'err' : line.startsWith('✓') ? 'ok' : ''}>{line}</div>
              ))}
            </div>
            <div className="supersede-note mono">
              日志：{tr.logPath} · 任务 {tr.taskId}
              {tr.supersedes && <> · 取代 {tr.supersedes}</>}
              {tr.supersededBy && <> · 已被 {tr.supersededBy} 取代（代码变化后重跑）</>}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

/* ---------- 审批 ---------- */
function ApprovalView({ engine }: { engine: import('@studio/core').StudioEngine }) {
  const s = engine.state;
  const [notes, setNotes] = useState<Record<string, string>>({});
  const approvals = Object.values(s.approvals).sort((a, b) => b.requestedAt - a.requestedAt);

  const decide = (a: Approval, approved: boolean) => {
    engine.decideApproval(a.id, approved, notes[a.id] || undefined);
  };

  return (
    <>
      {approvals.filter((a) => a.status === 'pending').map((a) => (
        <div className="approval-card pending" key={a.id}>
          <div className="subj">
            <span className="chip amber">{APPROVAL_KIND_LABELS[a.kind]}</span> {a.subject}
          </div>
          <div className="desc">{a.description}</div>
          <div className="approval-actions">
            <input
              placeholder="意见（可选，驳回时请说明原因）"
              value={notes[a.id] ?? ''}
              onChange={(e) => setNotes((m) => ({ ...m, [a.id]: e.target.value }))}
            />
            <button className="btn approve" onClick={() => decide(a, true)}>批准</button>
            <button className="btn reject" onClick={() => decide(a, false)}>驳回</button>
          </div>
        </div>
      ))}
      {approvals.filter((a) => a.status === 'pending').length === 0 && (
        <div className="sect"><span style={{ color: 'var(--text-faint)' }}>当前没有待审批事项。</span></div>
      )}
      <div className="sect">
        <h4>审批历史</h4>
        {approvals.filter((a) => a.status !== 'pending').map((a) => (
          <div key={a.id} style={{ marginBottom: 6, fontSize: 12 }}>
            <span className={`chip ${a.status === 'approved' ? 'green' : 'red'}`}>
              {a.status === 'approved' ? '已批准' : '已驳回'}
            </span>
            {a.subject}
            {a.note && <span style={{ color: 'var(--text-dim)' }}> — {a.note}</span>}
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------- 变更 ---------- */
function ChangeView({ s, onSelectTask, openTask }: { s: ProjectState; onSelectTask: (id: string) => void; openTask: () => void }) {
  const crs = Object.values(s.changeRequests);
  if (crs.length === 0) {
    return (
      <div className="sect">
        <p style={{ color: 'var(--text-faint)', lineHeight: 1.7 }}>
          交付完成后可在底部输入新想法。所有变更都会建立 Change Request、影响分析与新的需求版本——绝不静默覆盖。
        </p>
      </div>
    );
  }
  return (
    <>
      {crs.map((cr) => (
        <div className="approval-card" key={cr.id}>
          <div className="subj">
            <span className={`chip ${cr.classification === 'major' ? 'red' : cr.classification === 'minor' ? 'yellow' : 'cyan'}`}>
              {cr.classification === 'major' ? '重大变更' : cr.classification === 'minor' ? '低影响' : '澄清'}
            </span>
            {cr.id}：{cr.userText}
          </div>
          <div className="desc">
            {cr.classificationNote}
            {cr.status === 'analyzing' && <span className="chip amber">分析中</span>}
            {cr.status === 'awaiting_approval' && <span className="chip amber">等待审批</span>}
            {cr.status === 'approved' && <span className="chip green">已批准</span>}
            {cr.status === 'rejected' && <span className="chip red">已拒绝</span>}
            {cr.status === 'implemented' && <span className="chip green">已实施</span>}
          </div>
          {cr.impact && (
            <dl className="kv" style={{ fontSize: 12 }}>
              <dt>新增任务</dt>
              <dd>
                {cr.impact.tasks.map((t) => (
                  <a key={t} style={{ color: 'var(--cyan)', cursor: 'pointer', marginRight: 8 }} onClick={() => { const id = t.match(/T\d+/)?.[0]; if (id) { onSelectTask(id); openTask(); } }}>
                    {t}
                  </a>
                ))}
              </dd>
              <dt>影响文件</dt><dd className="mono" style={{ fontSize: 11 }}>{cr.impact.files.join('、')}</dd>
              <dt>测试</dt><dd>{cr.impact.tests.join('；')}</dd>
              <dt>预算影响</dt><dd>{cr.impact.budgetDelta}</dd>
              <dt>说明</dt><dd style={{ color: 'var(--text-dim)' }}>{cr.impact.notes}</dd>
            </dl>
          )}
        </div>
      ))}
    </>
  );
}

/* ---------- 事件流 ---------- */
function EventsView({ engine }: { engine: import('@studio/core').StudioEngine }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const events = engine.events;
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);
  const shown = events.slice(-200);
  return (
    <div ref={ref} className="logbox" style={{ maxHeight: 'none', flex: 1 }}>
      {shown.map((env) => {
        const e = env.evt;
        const cls = e.type === 'log' && e.level === 'error' ? 'err'
          : e.type === 'log' && e.level === 'success' ? 'ok'
          : e.type === 'log' && e.level === 'warn' ? 'warn' : '';
        return (
          <div className={`event-row ${cls}`} key={env.seq}>
            <span className="seq">{env.seq}</span>
            <span className="t">{fmtClock(env.at)}</span>
            <span className="msg">{eventText(env)}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Agent 详情 ---------- */
const STATUS_TEXT: Record<string, string> = {
  idle: '空闲 · 工位待命', analyzing: '分析/规划中', working: '编码/设计中',
  testing: '运行测试', awaiting_review: '举手等待主管复核', blocked: '阻塞 · 需要用户',
  failed: '失败',
};

function AgentView({
  s, role, onSelectTask, openTask,
}: {
  s: ProjectState; role: import('@studio/core').AgentRole;
  onSelectTask: (id: string) => void; openTask: () => void;
}) {
  const a = s.agents[role];
  const runs = Object.values(s.agentRuns).filter((r) => r.role === role);
  const totalCost = runs.reduce((acc, r) => acc + (r.usage?.costUsd ?? 0), 0);
  const model = runs[runs.length - 1]?.model;
  return (
    <>
      <div className="sect">
        <h4>{ROLE_LABELS[role]}</h4>
        <div className="kv">
          <dt>状态</dt>
          <dd>
            <span className={`chip ${a?.status === 'failed' ? 'red' : a?.status === 'blocked' ? 'amber' : a?.status === 'idle' ? '' : 'cyan'}`}>
              {STATUS_TEXT[a?.status ?? 'idle']}
            </span>
          </dd>
          <dt>当前动作</dt><dd>{a?.detail ?? '—'}</dd>
          {a?.reason && (<><dt>原因</dt><dd style={{ color: 'var(--amber)' }}>{a.reason}</dd></>)}
          <dt>执行次数</dt><dd>{runs.length} 次 · ${totalCost.toFixed(2)}</dd>
          {model && (<><dt>模型</dt><dd className="mono" style={{ fontSize: 11 }}>{model.provider}/{model.modelId}</dd></>)}
        </div>
      </div>
      {a?.currentTaskId && (
        <div className="sect">
          <h4>当前任务</h4>
          <span
            className="chip cyan"
            style={{ cursor: 'pointer' }}
            onClick={() => { onSelectTask(a.currentTaskId!); openTask(); }}
          >
            {a.currentTaskId} · {s.tasks[a.currentTaskId]?.title}
          </span>
        </div>
      )}
      <div className="sect">
        <h4>最近动作</h4>
        <div className="logbox">
          {runs.flatMap((r) => r.steps).slice(-14).map((step, i) => (
            <div key={i}>{step.tool ? `<${step.tool}> ` : ''}{step.detail}</div>
          ))}
          {runs.length === 0 && <span style={{ color: 'var(--text-faint)' }}>尚未执行任务</span>}
        </div>
      </div>
    </>
  );
}
