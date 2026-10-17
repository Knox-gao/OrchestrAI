/**
 * StudioEngine —— 演播引擎（P1：模拟 Agent 驱动 UI；P2 起替换为真实 Agent 执行）。
 *
 * 设计要点：
 * - 事件是唯一输出；UI 订阅 state，不持有私有状态。
 * - 审批点与变更输入是显式暂停点（wait cue），对应计划"关键节点需用户决策"。
 * - autoApprove 模式供自动化测试与"全自动演示"使用。
 * - 时间是虚拟时钟（clock），保证重放/测试确定性。
 */
import { EventLog } from './eventLog';
import { applyEvent, initialState } from './state';
import type { Envelope, StudioEvent } from './events';
import type { ProjectState } from './types';

export interface Cue {
  /** 距上一 cue 的虚拟毫秒数 */
  d: number;
  events?: StudioEvent[];
  wait?: 'approval' | 'change';
  label?: string;
}

export type EngineStatus =
  | 'idle' | 'running' | 'paused'
  | 'awaiting_approval' | 'awaiting_change' | 'finished';

export interface Scenario {
  /** 开场：创建项目 + 提交首个需求 */
  boot(): Cue[];
  /** 某个审批被决定后的后续 */
  onApproval(approvalId: string, approved: boolean, state: ProjectState): Cue[];
  /** 用户在等待变更输入点提交了新想法 */
  onChange(text: string, state: ProjectState): Cue[];
}

export interface EngineOptions {
  speed?: number;
  autoApprove?: boolean;
  autoChangeText?: string | null;
}

export class StudioEngine {
  private log = new EventLog();
  private _state: ProjectState = initialState();
  private queue: Cue[] = [];
  private scenario: Scenario;
  private listeners = new Set<() => void>();
  private clock = 0;
  private acc = 0;
  private autoAcc = 0;

  status: EngineStatus = 'idle';
  speed = 1;
  autoApprove = false;
  autoChangeText: string | null = null;
  /** 每个事件后的状态快照（测试用） */
  history: ProjectState[] = [];

  constructor(scenario: Scenario, opts: EngineOptions = {}) {
    this.scenario = scenario;
    this.speed = opts.speed ?? 1;
    this.autoApprove = opts.autoApprove ?? false;
    this.autoChangeText = opts.autoChangeText ?? null;
  }

  get state(): ProjectState { return this._state; }
  get events(): readonly Envelope[] { return this.log.all(); }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() { for (const fn of this.listeners) fn(); }

  private setStatus(s: EngineStatus) {
    if (this.status === s) return;
    this.status = s;
    this.autoAcc = 0;
    this.notify();
  }

  private emit(evt: StudioEvent) {
    const env = this.log.append(evt, this.clock);
    this._state = applyEvent(structuredClone(this._state), env);
    this.history.push(this._state);
    this.notify();
  }

  // ---- 播放控制 ----

  start() {
    if (this.status !== 'idle') return;
    this.enqueue(this.scenario.boot());
    this.setStatus('running');
  }

  pause() { if (this.status === 'running') this.setStatus('paused'); }
  resume() { if (this.status === 'paused') this.setStatus('running'); }

  setSpeed(s: number) { this.speed = s; this.notify(); }

  /** 单步：立即触发下一个 cue（用于演示/调试） */
  stepOnce() {
    if (this.status !== 'running' && this.status !== 'paused') return;
    const cue = this.queue.shift();
    if (!cue) { this.drainCheck(); return; }
    this.acc = 0;
    this.fire(cue);
    this.drainCheck();
  }

  private enqueue(cues: Cue[]) { this.queue.push(...cues); }

  private fire(cue: Cue) {
    this.clock += cue.d;
    if (cue.events) for (const e of cue.events) this.emit(e);
    if (cue.wait === 'approval') this.setStatus('awaiting_approval');
    else if (cue.wait === 'change') this.setStatus('awaiting_change');
  }

  /** 每帧驱动（UI 的 rAF/interval 调用；测试中可用 runToCompletion） */
  tick(dtMs: number) {
    // 全自动模式：替用户决策（留出一点"阅读时间"）
    this.autoAcc += dtMs * this.speed;
    if (this.autoApprove && this.status === 'awaiting_approval' && this.autoAcc > 500) {
      const pending = this.firstPendingApproval();
      if (pending) this.decideApproval(pending.id, true, '（全自动演示：自动批准）');
      return;
    }
    if (this.autoApprove && this.autoChangeText && this.status === 'awaiting_change' && this.autoAcc > 800) {
      this.submitChange(this.autoChangeText);
      return;
    }
    if (this.status !== 'running') return;

    this.acc += dtMs * this.speed;
    let guard = 0;
    while (this.status === 'running' && this.queue.length > 0 && guard++ < 1000) {
      const cue = this.queue[0]!;
      if (this.acc < cue.d) break;
      this.queue.shift();
      this.acc -= cue.d;
      this.fire(cue);
    }
    this.drainCheck();
  }

  private drainCheck() {
    if (this.status === 'running' && this.queue.length === 0) this.setStatus('finished');
  }

  // ---- 用户输入 ----

  firstPendingApproval() {
    return Object.values(this._state.approvals)
      .sort((a, b) => a.requestedAt - b.requestedAt)
      .find((a) => a.status === 'pending');
  }

  decideApproval(approvalId: string, approved: boolean, note?: string) {
    const a = this._state.approvals[approvalId];
    if (!a || a.status !== 'pending' || this.status !== 'awaiting_approval') return;
    this.emit({ type: 'approval_decided', approvalId, approved, note });
    const follow = this.scenario.onApproval(approvalId, approved, this._state);
    this.enqueue(follow);
    this.acc = 0;
    this.setStatus('running');
  }

  submitChange(text: string) {
    if (this.status !== 'awaiting_change') return;
    const follow = this.scenario.onChange(text.trim(), this._state);
    if (follow.length === 0) return;
    this.enqueue(follow);
    this.acc = 0;
    this.setStatus('running');
  }

  /** 仅供测试：无视等待时间跑到终态（autoApprove 需开启） */
  runToCompletion(maxSteps = 100000) {
    this.start();
    for (let i = 0; i < maxSteps; i++) {
      this.tick(10_000);
      if (this.status === 'finished') return;
    }
    throw new Error('runToCompletion 超过步数上限，剧本可能存在死循环');
  }

  /**
   * 注入外部事件（P2 真实生成模式）：服务端执行真实流水线后，
   * 将真实事件作为播放队列交给引擎，UI 走完全相同的渲染与门禁逻辑。
   */
  play(cues: Cue[]) {
    this.enqueue(cues);
    if (this.status === 'idle' || this.status === 'finished' || this.status === 'paused') {
      this.setStatus('running');
    }
  }

  /**
   * 从持久化的 cue 队列瞬时恢复项目状态（主页进入历史项目）。
   * 忽略时间差逐步补齐事件，终态与逐帧回放完全一致（事件溯源）。
   */
  restoreSync(cues: Cue[]) {
    if (this.status !== 'idle') return;
    for (const cue of cues) {
      this.clock += cue.d;
      if (cue.events) for (const e of cue.events) this.emit(e);
    }
    this.setStatus('finished');
  }
}
