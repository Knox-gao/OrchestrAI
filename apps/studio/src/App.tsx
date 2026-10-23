import { useState } from 'react';
import { initialState, type AgentRole } from '@studio/core';
import { fetchProject, generateApp, runPreflight, useStudioApp } from './useStudio';
import { TopBar } from './components/TopBar';
import { TaskBoard } from './components/TaskBoard';
import { PixelOffice } from './components/PixelOffice';
import { DetailPanel, type TabKey } from './components/DetailPanel';
import { ChatDock } from './components/ChatDock';
import { HomePage } from './components/HomePage';
import { ChoiceModal, type ChoiceQuestion } from './components/ChoiceModal';

export type Mode = 'demo' | 'real';

/** 初始空状态（真实模式尚未生成时，与内核 reducer 同源） */
const EMPTY_STATE = initialState();

export default function App() {
  const { engine, startDemo, playInNew, enterProject, close } = useStudioApp();
  const [view, setView] = useState<'home' | 'studio'>('home');
  const [mode, setMode] = useState<Mode>('real');
  const [tab, setTab] = useState<TabKey>('req');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentRole | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string>('');
  const [styleSel, setStyleSel] = useState('');
  const [fxSel, setFxSel] = useState('');
  const [styleDescSel, setStyleDescSel] = useState('');
  const [model, setModel] = useState('auto');
  const [dockOpen, setDockOpen] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  /** 开工前确认（内测版：AI 的主观审美选择交给用户拍板） */
  const [pendingChoice, setPendingChoice] = useState<{ requirement: string; questions: ChoiceQuestion[] } | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});

  /** 需求生成：真实流水线 → 新引擎播放（服务端每次生成都创建新项目） */
  const submitReal = async (requirement: string, answers: Record<string, string> = {}) => {
    const useName = projectName || (engine?.state.projectName ?? '');
    setGenerating(true);
    setPhase('创建任务…');
    setGenError(null);
    setPreviewUrl(null);
    setTab('events');
    try {
      setPhase('创建任务…');
      const result = await generateApp(requirement, styleSel, fxSel, useName || undefined, styleDescSel || undefined, (p) => setPhase(p), model, answers);
      playInNew(result.cues);
      setPreviewUrl(result.previewUrl);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
      setPhase(null);
    }
  };

  /**
   * 开工前确认：先问 AI「有没有必须用户拍板的审美选择」。
   * - 有 → 弹选择卡，用户选完再生成
   * - 无 / 模型未配置 → 直接生成（缺模型时管线会明确阻断并提示配 Key）
   */
  const submitWithPreflight = async (requirement: string) => {
    setGenError(null);
    setChoices({});
    let pf;
    try {
      pf = await runPreflight(requirement, model);
    } catch {
      return void submitReal(requirement);   // 确认环节异常不阻断主流程
    }
    if (pf.ok && pf.questions.length > 0) {
      setPendingChoice({ requirement, questions: pf.questions });
      return;
    }
    if (pf.reason && !pf.ok && pf.viaLLM === false) {
      // 模型未配置：直接走生成，由管线给出明确的"请配置模型"阻断提示
      setGenError(pf.reason);
      return void submitReal(requirement);
    }
    return void submitReal(requirement);
  };

  /** 进入历史项目：拉取时间线，瞬时恢复终态 */
  const enterById = async (id: string, fallbackPreviewUrl: string | null) => {
    setGenError(null);
    try {
      const { meta, cues } = await fetchProject(id);
      setMode('real');
      setPreviewUrl(meta.previewUrl ?? fallbackPreviewUrl);
      enterProject(cues);
      setTab('req');
      setSelectedTaskId(null);
      setSelectedAgent(null);
      setView('studio');
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    }
  };

  const goHome = () => {
    close();
    setView('home');
    setPreviewUrl(null);
    setGenerating(false);
  };

  if (view === 'home') {
    return (
      <HomePage
        style={styleSel} setStyle={setStyleSel}
        fx={fxSel} setFx={setFxSel}
        styleDesc={styleDescSel} setStyleDesc={setStyleDescSel}
        onSubmitProject={(name) => {
          setMode('real'); setProjectName(name); setPreviewUrl(null);
          setTab('events'); setGenError(null);
          close();
          setView('studio');
          setDockOpen(true); // 创建后自动展开对话面板，引导输入需求
        }}
        onEnterProject={(meta) => { void enterById(meta.id, meta.previewUrl); }}
        onDemo={() => { setMode('demo'); startDemo(); setTab('req'); setView('studio'); }}
      />
    );
  }

  const choiceModal = pendingChoice ? (
    <ChoiceModal
      questions={pendingChoice.questions}
      busy={generating}
      onCancel={() => setPendingChoice(null)}
      onConfirm={(answers) => {
        const req = pendingChoice.requirement;
        setChoices(answers);
        setPendingChoice(null);
        void submitReal(req, answers);
      }}
    />
  ) : null;

  return (
    <>
      {choiceModal}
      {genError && (
        <div className="gen-error">
          {genError}
          <button onClick={() => setGenError(null)}>关闭</button>
        </div>
      )}
      <div className="app">
        <TopBar engine={engine} mode={mode} onHome={goHome} fallbackName={projectName} />
        <TaskBoard
          state={engine ? engine.state : EMPTY_STATE}
          selectedTaskId={selectedTaskId}
          onSelectTask={(id) => { setSelectedTaskId(id); setSelectedAgent(null); setTab('task'); }}
        />
        <PixelOffice
          state={engine ? engine.state : EMPTY_STATE}
          selectedAgent={selectedAgent}
          onSelectAgent={(role) => { setSelectedAgent(role); setTab('agent'); }}
        />
        {engine && (
          <DetailPanel
            engine={engine}
            tab={tab}
            setTab={setTab}
            selectedTaskId={selectedTaskId}
            onSelectTask={(id) => { setSelectedTaskId(id); setTab('task'); }}
            selectedAgent={selectedAgent}
            previewUrl={mode === 'real' ? previewUrl : null}
          />
        )}
        <ChatDock
          engine={engine}
          mode={mode}
          generating={generating}
          phase={phase}
          projectName={projectName}
          style={styleSel} setStyle={setStyleSel}
          fx={fxSel} setFx={setFxSel}
          styleDesc={styleDescSel} setStyleDesc={setStyleDescSel}
          model={model} setModel={setModel}
          open={dockOpen} setOpen={setDockOpen}
          onSubmitReal={(req) => void submitWithPreflight(req)}
        />
      </div>
    </>
  );
}
