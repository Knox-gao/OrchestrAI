/**
 * 规范化事件定义 —— UI 与后台之间唯一的通信语言。
 * 计划 3.2：UI 只消费事件，角色动画不是事实来源。
 */
import type {
  AgentRole, AgentVisualStatus, Approval, Artifact, ChangeRequest,
  DeliveryInfo, GateName, ModelRef, ProjectStatus, RequirementVersion,
  RunStep, TaskKind, TaskStatus, TestRun,
} from './types';

/** 计划中的任务定义（输入/输出契约先行，见计划第十一章风险控制） */
export interface TaskSeed {
  id: string;
  title: string;
  kind: TaskKind;
  role: AgentRole;
  dependsOn: string[];
  inputs: string[];
  outputs: string[];
}

export type StudioEvent =
  | { type: 'project_created'; projectId: string; projectName: string; workspace: string }
  | { type: 'phase_changed'; phase: string; status?: ProjectStatus }
  | { type: 'requirement_submitted'; userText: string; version: string }
  | { type: 'requirement_drafted'; requirement: RequirementVersion }
  | { type: 'requirement_confirmed'; requirementId: string; version: string }
  | { type: 'approval_requested'; approval: Approval }
  | { type: 'approval_decided'; approvalId: string; approved: boolean; note?: string }
  | { type: 'plan_created'; tasks: TaskSeed[]; note: string }
  | { type: 'task_status_changed'; taskId: string; from: TaskStatus; to: TaskStatus; reason?: string; attempt?: number }
  | { type: 'agent_run_started'; runId: string; taskId: string; role: AgentRole; model: ModelRef }
  | { type: 'agent_step'; runId: string; taskId: string; role: AgentRole; step: RunStep }
  | { type: 'agent_run_ended'; runId: string; taskId: string; status: 'succeeded' | 'failed'; usage: { inputTokens: number; outputTokens: number; costUsd: number } }
  | { type: 'agent_state_changed'; role: AgentRole; status: AgentVisualStatus; taskId?: string; detail?: string; reason?: string }
  | { type: 'artifact_created'; artifact: Artifact }
  | { type: 'test_run_recorded'; testRun: TestRun } // 只能来自测试运行器（模拟运行器同样产出完整证据）
  | { type: 'gate_result'; gate: GateName; passed: boolean; detail: string; testRunId?: string; taskId?: string }
  | { type: 'change_requested'; cr: ChangeRequest }
  | { type: 'change_analyzed'; cr: ChangeRequest }
  | { type: 'requirement_superseded'; oldId: string; newId: string; newVersion: string }
  | { type: 'delivery_packaged'; delivery: DeliveryInfo }
  | { type: 'log'; level: 'info' | 'warn' | 'error' | 'success'; message: string; from?: AgentRole };

/** 事件信封：全局递增序号 + 时间戳 */
export interface Envelope {
  seq: number;
  at: number;
  evt: StudioEvent;
}

export function eventText(env: Envelope): string {
  const e = env.evt;
  switch (e.type) {
    case 'project_created': return `项目创建：${e.projectName}（工作区 ${e.workspace}）`;
    case 'phase_changed': return `进入「${e.phase}」`;
    case 'requirement_submitted': return `用户提交需求：${e.userText}`;
    case 'requirement_drafted': return `主管起草需求规格 ${e.requirement.version}（${e.requirement.userStories.length} 个用户故事）`;
    case 'requirement_confirmed': return `需求规格 ${e.version} 已确认`;
    case 'approval_requested': return `发起审批［${e.approval.kind}］：${e.approval.subject}`;
    case 'approval_decided': return e.approved ? `审批通过：${e.approvalId}` : `审批驳回：${e.approvalId}${e.note ? `（${e.note}）` : ''}`;
    case 'plan_created': return `主管生成任务计划（${e.tasks.length} 项任务）：${e.note}`;
    case 'task_status_changed': return `任务 ${e.taskId}：${e.from} → ${e.to}${e.reason ? `（${e.reason}）` : ''}`;
    case 'agent_run_started': return `${e.role} 开始执行任务 ${e.taskId}（模型 ${e.model.provider}/${e.model.modelId}）`;
    case 'agent_step': {
      const s = e.step;
      return s.kind === 'tool' ? `[${e.role}] 工具 ${s.tool}：${s.detail}` : `[${e.role}] ${s.detail}`;
    }
    case 'agent_run_ended': return `任务 ${e.taskId} 执行${e.status === 'succeeded' ? '完成' : '失败'}（+$${e.usage.costUsd.toFixed(2)}，${e.usage.inputTokens + e.usage.outputTokens} tokens）`;
    case 'agent_state_changed': return `[${e.role}] 状态 → ${e.status}${e.detail ? `：${e.detail}` : ''}${e.reason ? `（原因：${e.reason}）` : ''}`;
    case 'artifact_created': return `产物：${e.artifact.path} —— ${e.artifact.summary}`;
    case 'test_run_recorded': {
      const t = e.testRun;
      return `测试运行器 [${t.kind}] ${t.command} → 退出码 ${t.exitCode}（${t.passed} 通过 / ${t.failed} 失败），日志 ${t.logPath}`;
    }
    case 'gate_result': return `门禁［${e.gate}］${e.passed ? '通过' : '未通过'}：${e.detail}`;
    case 'change_requested': return `用户提出变更：${e.cr.userText}`;
    case 'change_analyzed': return `变更 ${e.cr.id} 影响分析完成：${e.cr.impact ? `${e.cr.impact.tasks.length} 项任务、${e.cr.impact.files.length} 个文件受影响` : e.cr.classificationNote}`;
    case 'requirement_superseded': return `需求版本 ${e.oldId} 被 ${e.newVersion} 取代（历史保留）`;
    case 'delivery_packaged': return `交付包 ${e.delivery.version} 生成：${e.delivery.manifest.length} 项内容，已知限制 ${e.delivery.knownLimits.length} 项`;
    case 'log': return `${e.from ? `[${e.from}] ` : ''}${e.message}`;
  }
}
