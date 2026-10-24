/**
 * ChatDock：右下角圆形悬浮按钮 + 拟短信对话面板。
 * 汇聚：需求输入 / 文档附件 / 主模型切换 / 暂停回放。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { StudioEngine } from '@studio/core';
import { eventText } from '@studio/core';
import type { Mode } from '../App';

interface Msg { id: number; role: 'user' | 'sys'; text: string; tone?: 'ok' | 'warn' | 'err'; }

export function ChatDock({
  engine, mode, generating, phase, projectName, model, setModel,
  open, setOpen, onSubmitReal,
}: {
  engine: StudioEngine | null;
  mode: Mode;
  generating: boolean;
  phase: string | null;
  projectName: string;
  model: string; setModel: (v: string) => void;
  open: boolean; setOpen: (v: boolean) => void;
  onSubmitReal: (requirement: string) => void;
}) {
  const [text, setText] = useState('');
  const [docName, setDocName] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [models, setModels] = useState<{ id: string; label: string; configured: boolean; custom: boolean }[]>([]);
  const [tab, setTab] = useState<'chat' | 'model'>('chat');
  const [testResult, setTestResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const flowRef = useRef<HTMLDivElement | null>(null);
  const st = engine?.status ?? 'idle';
  const isReal = mode === 'real';
  const paused = st === 'paused';

  // 主模型列表（已配置的 LLM 网关 + 规则识别）
  useEffect(() => {
    if (!open) return;
    fetch('/api/keys').then((r) => r.json()).then((list: any[]) => {
      const usable = list
        .filter((k) => k.configured && (k.id === 'zhipu' || k.id === 'openai' || k.custom))
        .map((k) => ({
          id: k.custom ? `custom:${k.id}` : k.id,
          label: k.custom ? `${k.label}（自定义）` : k.label,
          configured: true, custom: !!k.custom,
        }));
      setModels(usable);
      if (model !== 'auto' && !usable.some((u) => u.id === model)) setModel('auto');
    }).catch(() => setModels([]));
  }, [open, setModel]);

  // 关键事件 → 系统消息（去重，只保留关键节点）
  const seenRef = useRef(0);
  const [sysMsgs, setSysMsgs] = useState<Msg[]>([]);
  useEffect(() => {
    if (!engine) return;
    const events = engine.events;
    const fresh = events.slice(seenRef.current);
    seenRef.current = events.length;
    const add: Msg[] = [];
    for (const env of fresh) {
      const e = env.evt;
      const keep =
        e.type === 'requirement_submitted' || e.type === 'delivery_packaged' ||
        e.type === 'test_run_recorded' || e.type === 'gate_result' ||
        (e.type === 'log' && (e.level === 'error' || e.level === 'warn' || e.level === 'success'));
      if (!keep) continue;
      const text = eventText(env);
      const tone = (e.type === 'gate_result' && !e.passed) || (e.type === 'log' && e.level === 'error') ? 'err'
        : (e.type === 'delivery_packaged') || (e.type === 'log' && e.level === 'success') ? 'ok'
        : e.type === 'log' && e.level === 'warn' ? 'warn' : undefined;
      add.push({ id: env.seq, role: 'sys', text, tone });
    }
    if (add.length) setSysMsgs((m) => [...m, ...add].slice(-60));
  }, [engine, engine?.events.length]);

  const userMsgs = useMemo<Msg[]>(() => [], []);
  const [myMsgs, setMyMsgs] = useState<Msg[]>([]);
  const send = () => {
    if (generating || !text.trim()) return;
    if (isReal) {
      setMyMsgs((m) => [...m, { id: Date.now(), role: 'user', text: text.trim() }]);
      onSubmitReal(text.trim());
      setText('');
      setDocName(null);
    } else if (isDemoChange && engine) {
      engine.submitChange(text.trim());
      setMyMsgs((m) => [...m, { id: Date.now(), role: 'user', text: text.trim() }]);
      setText('');
    }
  };

  const onFile = async (file: File) => {
    setDocError(null);
    try {
      const buf = await file.arrayBuffer();
      const res = await fetch('/api/requirements/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'x-filename': encodeURIComponent(file.name) },
        body: buf,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `解析失败（${res.status}）`);
      setDocName(file.name);
      setText((prev) => (prev.trim() ? prev + '\n\n' + data.text : data.text));
    } catch (e) {
      setDocError(e instanceof Error ? e.message : String(e));
    }
  };

  // 消息流自动滚底
  useEffect(() => {
    const el = flowRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [sysMsgs.length, myMsgs.length, phase, open]);

  const isDemoChange = mode === 'demo' && st === 'awaiting_change' && text.trim().length > 0 && Boolean(engine);
  const canSend = (isReal && !generating && text.trim().length > 0) || isDemoChange;

  return (
    <>
      {/* 拟短信面板 */}
      <div className={`dock ${open ? 'open' : ''}`}>
        <div className="dock-head">
          <span className="dock-title">OrchestrAI · 对话</span>
          <button className="dock-icon" title={paused ? '继续回放' : '暂停回放'}
            disabled={!engine || (st !== 'running' && st !== 'paused')}
            onClick={() => (paused ? engine?.resume() : engine?.pause())}
          >{paused ? '▶' : '⏸'}</button>
          <button className="dock-icon" title="收起" onClick={() => setOpen(false)}>✕</button>
        </div>

        <div className="dock-tabs">
          {[['chat', '💬 对话'], ['model', '🔑 主模型']].map(([id, label]) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id as typeof tab)}>{label}</button>
          ))}
        </div>

        {tab === 'chat' && (
          <>
            <div className="dock-flow" ref={flowRef}>
              {sysMsgs.length === 0 && myMsgs.length === 0 && (
                <div className="dock-empty">
                  {projectName ? <>项目「{projectName}」已创建。<br />在下方输入需求，或 📎 附加 Word/txt/md 文档。</> : '输入你的需求开始创建'}
                </div>
              )}
              {myMsgs.map((m) => <div className="bubble user" key={`u${m.id}`}>{m.text}</div>)}
              {generating && phase && (
                <div className="bubble sys typing">⚙ {phase}</div>
              )}
              {sysMsgs.map((m) => (
                <div className={`bubble sys ${m.tone ?? ''}`} key={`s${m.id}`}>{m.text}</div>
              ))}
              {engine?.state.delivery && (
                <div className="bubble sys ok">
                  🎉 打开「预览」页签查看生成的网站，或下载网页 ZIP（解压即可独立运行）。
                </div>
              )}
            </div>
            {docError && <div className="dock-err">📎 {docError}</div>}
            {docName && <div className="dock-doc">📎 {docName} <button onClick={() => setDocName(null)}>✕</button></div>}
            <div className="dock-input">
              <input
                ref={(el) => { (fileRef as { current: HTMLInputElement | null }).current = el; }}
                type="file" accept=".docx,.txt,.md,.markdown" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }}
              />
              <button className="dock-icon" title="附加 Word/txt/md 需求文档" disabled={generating}
                onClick={() => (fileRef as { current: HTMLInputElement | null }).current?.click()}>📎</button>
              <textarea
                rows={1}
                value={text}
                disabled={generating}
                placeholder={isReal ? '输入需求…（Enter 发送）' : st === 'awaiting_change' ? '输入新需求变更…' : '演示模式：变更入口在交付后开启'}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              />
              <button className="dock-send" disabled={!canSend} onClick={send} title="发送需求">➤</button>
            </div>
          </>
        )}

        {tab === 'model' && (
          <div className="dock-settings">
            <div className="dock-label">主模型（需求理解引擎）</div>
            <select className="dock-select" value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="auto">自动（优先 AI，失败回退规则）</option>
              <option value="rule">规则识别（不调用 AI）</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <button
              className="dock-test"
              onClick={async () => {
                setTestResult('测试中…');
                try {
                  const res = await fetch('/api/keys/test', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ llm: model === 'rule' ? 'auto' : model }),
                  });
                  const d = await res.json();
                  setTestResult(d.ok
                    ? `✅ ${d.provider}/${d.model} 连通（${d.ms}ms）：${d.reply}`
                    : `❌ ${d.provider ?? ''}/${d.model ?? ''} ${d.error ?? '失败'}`);
                } catch (e) { setTestResult(`❌ ${String(e)}`); }
              }}
            >🔌 测试连接</button>
            {testResult && <div className="dock-test-result">{testResult}</div>}
            <div className="dock-note">
              在主页 🔑 API Key 中配置 GLM / OpenAI / 自定义网关（含模型名）后，这里会出现对应选项。
              当前：{model === 'auto' ? '自动' : model === 'rule' ? '规则识别' : models.find((m) => m.id === model)?.label ?? model}
            </div>
          </div>
        )}
      </div>

      {/* 右下角圆形悬浮按钮 */}
      <button
        className={`dock-fab ${open ? 'open' : ''} ${generating ? 'busy' : ''}`}
        title="OrchestrAI 对话"
        onClick={() => setOpen(!open)}
      >
        {generating ? <span className="fab-spinner" /> : open ? '✕' : <span className="fab-phone">📞</span>}
        {generating && <span className="fab-badge" />}
      </button>
    </>
  );
}
