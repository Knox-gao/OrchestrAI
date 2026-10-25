import { useEffect, useState } from 'react';
import { initialState, type AgentRole } from '@studio/core';
import { fetchProject, generateApp, reviseApp, runPreflight, useStudioApp } from './useStudio';
import { TopBar } from './components/TopBar';
import { TaskBoard } from './components/TaskBoard';
import { PixelOffice } from './components/PixelOffice';
import { DetailPanel, type TabKey } from './components/DetailPanel';
import { ChatDock } from './components/ChatDock';
import { HomePage } from './components/HomePage';
import { ChoiceModal, type ChoiceQuestion } from './components/ChoiceModal';

export type Mode = 'demo' | 'real';
export type StudioView = 'canvas' | 'team';

/** 初始空状态（真实模式尚未生成时，与内核 reducer 同源） */
const EMPTY_STATE = initialState();

export default function App() {
  const { engine, startDemo, playInNew, enterProject, close } = useStudioApp();
  const [view, setView] = useState<'home' | 'studio'>('home');
  const [studioView, setStudioView] = useState<StudioView>('team');
  const [mode, setMode] = useState<Mode>('real');
  const [tab, setTab] = useState<TabKey>('req');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentRole | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string>('');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectVersion, setProjectVersion] = useState<number | null>(null);
  const [projectCanIterate, setProjectCanIterate] = useState<boolean | null>(null);
  const [styleSel, setStyleSel] = useState('');
  const [fxSel, setFxSel] = useState('');
  const [styleDescSel, setStyleDescSel] = useState('');
  const [model, setModel] = useState('auto');
  const [dockOpen, setDockOpen] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [phaseElapsedMs, setPhaseElapsedMs] = useState(0);
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  /** 开工前确认（内测版：AI 的主观审美选择交给用户拍板） */
  const [pendingChoice, setPendingChoice] = useState<{ requirement: string; questions: ChoiceQuestion[] } | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});

  /** 新建或基于当前版本迭代：真实流水线 → 新引擎播放 */
  const submitReal = async (requirement: string, answers: Record<string, string> = {}) => {
    const useName = projectName || (engine?.state.projectName ?? '');
    const baseProjectId = activeProjectId;
    setGenerating(true);
    setPhase(baseProjectId ? '准备基于当前版本修改…' : '创建任务…');
    setGenerationStartedAt((at) => at ?? Date.now());
    setGenError(null);
    if (!baseProjectId) setPreviewUrl(null);
    setTab('events');
    try {
      const onPhase = (p: string) => setPhase(p);
      const result = baseProjectId
        ? await reviseApp(baseProjectId, requirement, model, onPhase)
        : await generateApp(requirement, styleSel, fxSel, useName || undefined, styleDescSel || undefined, onPhase, model, answers);
      if (result.failed && baseProjectId) {
        setGenError(result.reason ?? '本轮修改没有通过交付门禁；上一版仍保留，可以继续预览或调整修改要求。');
        setTab('preview');
        setStudioView('canvas');
        return;
      }
      playInNew(result.cues);
      setActiveProjectId(result.failed ? null : result.projectId);
      setProjectVersion(result.failed ? null : (result.revisionNumber ?? 1));
      setProjectCanIterate(result.failed ? null : (result.hasPagePlanSnapshot ?? false));
      setPreviewUrl(result.previewUrl);
      setTab(result.previewUrl && !result.failed ? 'preview' : 'events');
      setStudioView(result.previewUrl && !result.failed ? 'canvas' : 'team');
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
      if (baseProjectId) { setTab('preview'); setStudioView('canvas'); }
    } finally {
      setGenerating(false);
      setPhase(null);
      setPhaseElapsedMs(0);
      setGenerationStartedAt(null);
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
    setGenerating(true);
    setPhase('模型正在分析需求…');
    setGenerationStartedAt(Date.now());
    setPhaseElapsedMs(0);
    let pf;
    try {
      pf = await runPreflight(requirement, model);
    } catch {
      setGenerating(false);
      setPhase(null);
      setGenerationStartedAt(null);
      return void submitReal(requirement);   // 确认环节异常不阻断主流程
    }
    if (pf.ok && pf.questions.length > 0) {
      setGenerating(false);
      setPhase(null);
      setGenerationStartedAt(null);
      setPendingChoice({ requirement, questions: pf.questions });
      return;
    }
    // 致命失败（额度用尽/Key 无效/未配置）：直接告知用户先修模型，不再启动生成
    if (pf.fatal || (pf.reason && !pf.ok && pf.viaLLM === false)) {
      setGenerating(false);
      setPhase(null);
      setGenerationStartedAt(null);
      setGenError(pf.reason || '模型不可用，请先在 🔑 主模型面板配置可用的 API');
      return;
    }
    return void submitReal(requirement);
  };

  useEffect(() => {
    if (!generating || generationStartedAt == null) return;
    const updateElapsed = () => setPhaseElapsedMs(Date.now() - generationStartedAt);
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [generating, generationStartedAt]);

  /** 进入历史项目：拉取时间线，瞬时恢复终态 */
  const enterById = async (id: string, fallbackPreviewUrl: string | null) => {
    setGenError(null);
    try {
      const { meta, cues } = await fetchProject(id);
      setMode('real');
      setActiveProjectId(id);
      setProjectVersion(meta.revisionNumber ?? 1);
      setProjectCanIterate(meta.hasPagePlanSnapshot === true);
      setProjectName(meta.projectTitle ?? meta.name);
      const availablePreview = meta.previewUrl ?? fallbackPreviewUrl;
      setPreviewUrl(availablePreview);
      enterProject(cues);
      setTab(availablePreview ? 'preview' : 'req');
      setStudioView(availablePreview ? 'canvas' : 'team');
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
    setStudioView('team');
    setActiveProjectId(null);
    setProjectVersion(null);
    setProjectCanIterate(null);
    setPreviewUrl(null);
    setGenerating(false);
    setPhase(null);
    setPhaseElapsedMs(0);
    setGenerationStartedAt(null);
  };

  if (view === 'home') {
    return (
      <HomePage
        style={styleSel} setStyle={setStyleSel}
        fx={fxSel} setFx={setFxSel}
        styleDesc={styleDescSel} setStyleDesc={setStyleDescSel}
        onSubmitProject={(name) => {
          setMode('real'); setStudioView('team'); setProjectName(name); setActiveProjectId(null); setProjectVersion(null); setProjectCanIterate(null); setPreviewUrl(null);
          setTab('events'); setGenError(null);
          close();
          setView('studio');
          setDockOpen(true); // 创建后自动展开对话面板，引导输入需求
        }}
        onEnterProject={(meta) => { void enterById(meta.id, meta.previewUrl); }}
        onDemo={() => { setMode('demo'); setStudioView('team'); setActiveProjectId(null); setProjectVersion(null); setProjectCanIterate(null); startDemo(); setTab('req'); setView('studio'); }}
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
      <div className={`app ${studioView === 'canvas' && mode === 'real' && previewUrl ? 'canvas-focus' : ''}`}>
        <TopBar
          engine={engine}
          mode={mode}
          onHome={goHome}
          fallbackName={projectVersion ? `${projectName} · 第 ${projectVersion} 版` : projectName}
          generating={generating}
          phase={phase}
          elapsedMs={phaseElapsedMs}
          studioView={studioView}
          hasPreview={mode === 'real' && Boolean(previewUrl)}
          onStudioViewChange={(next) => { setStudioView(next); if (next === 'canvas') setTab('preview'); }}
        />
        <TaskBoard
          state={engine ? engine.state : EMPTY_STATE}
          selectedTaskId={selectedTaskId}
          onSelectTask={(id) => { setSelectedTaskId(id); setSelectedAgent(null); setTab('task'); }}
        />
        <PixelOffice
          state={engine ? engine.state : EMPTY_STATE}
          selectedAgent={selectedAgent}
          onSelectAgent={(role) => { setSelectedAgent(role); setTab('agent'); }}
          thinking={generating}
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
            canIterate={mode === 'real' && projectCanIterate === true}
            onSubmitRevision={(request) => { setDockOpen(true); void submitReal(request); }}
          />
        )}
        <ChatDock
          engine={engine}
          mode={mode}
          projectId={activeProjectId}
          projectVersion={projectVersion}
          projectCanIterate={projectCanIterate}
          generating={generating}
          phase={phase}
          projectName={projectName}
          model={model} setModel={setModel}
          open={dockOpen} setOpen={setDockOpen}
          onSubmitReal={(req) => { if (activeProjectId) void submitReal(req); else void submitWithPreflight(req); }}
        />
      </div>
    </>
  );
}
