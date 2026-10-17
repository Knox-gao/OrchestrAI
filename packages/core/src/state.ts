/**
 * 状态重建器：由事件流折叠出当前项目状态。
 * 纯函数式的 apply/rebuild 保证：任何时刻崩溃，重放事件即可恢复。
 */
import type { Envelope, StudioEvent } from './events';
import { AGENT_ROLES, type AgentState, type ProjectState } from './types';

export function initialState(): ProjectState {
  const agents = {} as Record<string, AgentState>;
  for (const role of AGENT_ROLES) {
    agents[role] = { role, status: 'idle', since: 0 };
  }
  return {
    projectId: '',
    projectName: '',
    workspace: '',
    status: 'initialized',
    phase: '阶段 0 · 项目初始化',
    currentVersion: '',
    requirementVersions: {},
    tasks: {},
    agentRuns: {},
    artifacts: {},
    testRuns: {},
    approvals: {},
    changeRequests: {},
    agents: agents as ProjectState['agents'],
    gates: [],
    budget: { spentUsd: 0, capUsd: 5, inputTokens: 0, outputTokens: 0 },
    deliveries: [],
  };
}

/** 单事件应用（内部可变，外部传入克隆体或接受返回新对象的责任约定） */
export function applyEvent(state: ProjectState, env: Envelope): ProjectState {
  const e = env.evt;
  switch (e.type) {
    case 'project_created': {
      state.projectId = e.projectId;
      state.projectName = e.projectName;
      state.workspace = e.workspace;
      break;
    }
    case 'phase_changed': {
      state.phase = e.phase;
      if (e.status) state.status = e.status;
      break;
    }
    case 'requirement_submitted': {
      state.currentVersion = e.version;
      break;
    }
    case 'requirement_drafted': {
      state.requirementVersions[e.requirement.id] = { ...e.requirement };
      break;
    }
    case 'requirement_confirmed': {
      const rv = state.requirementVersions[e.requirementId];
      if (rv) { rv.status = 'confirmed'; rv.confirmedAt = env.at; }
      break;
    }
    case 'requirement_superseded': {
      const old = state.requirementVersions[e.oldId];
      if (old && old.status === 'confirmed') old.status = 'superseded';
      state.currentVersion = e.newVersion;
      break;
    }
    case 'approval_requested': {
      state.approvals[e.approval.id] = { ...e.approval, status: 'pending' };
      break;
    }
    case 'approval_decided': {
      const a = state.approvals[e.approvalId];
      if (a) {
        a.status = e.approved ? 'approved' : 'rejected';
        a.decidedAt = env.at;
        a.decidedBy = 'user';
        a.note = e.note;
      }
      break;
    }
    case 'plan_created': {
      const reqId = Object.values(state.requirementVersions)
        .filter((r) => r.status !== 'superseded')
        .sort((a, b) => b.createdAt - a.createdAt)[0]?.id ?? '';
      for (const seed of e.tasks) {
        state.tasks[seed.id] = {
          id: seed.id, title: seed.title, kind: seed.kind, role: seed.role,
          status: 'pending', dependsOn: seed.dependsOn, requirementVersionId: reqId,
          inputs: seed.inputs, outputs: seed.outputs, artifacts: [], testRuns: [],
          attempts: 0, createdAt: env.at, updatedAt: env.at,
        };
      }
      break;
    }
    case 'task_status_changed': {
      const task = state.tasks[e.taskId];
      if (!task) break;
      task.status = e.to;
      task.updatedAt = env.at;
      if (e.to === 'blocked') task.blockingReason = e.reason;
      else task.blockingReason = undefined;
      if (e.to === 'in_progress') task.attempts = e.attempt ?? task.attempts + 1;
      break;
    }
    case 'agent_run_started': {
      state.agentRuns[e.runId] = {
        id: e.runId, taskId: e.taskId, role: e.role, model: e.model,
        status: 'running', startedAt: env.at, steps: [],
      };
      break;
    }
    case 'agent_step': {
      state.agentRuns[e.runId]?.steps.push({ ...e.step });
      break;
    }
    case 'agent_run_ended': {
      const run = state.agentRuns[e.runId];
      if (run) {
        run.status = e.status;
        run.endedAt = env.at;
        run.usage = e.usage;
      }
      state.budget.spentUsd += e.usage.costUsd;
      state.budget.inputTokens += e.usage.inputTokens;
      state.budget.outputTokens += e.usage.outputTokens;
      break;
    }
    case 'agent_state_changed': {
      const a = state.agents[e.role];
      if (a) {
        a.status = e.status;
        a.currentTaskId = e.taskId;
        a.detail = e.detail;
        a.reason = e.reason;
        a.since = env.at;
      }
      break;
    }
    case 'artifact_created': {
      state.artifacts[e.artifact.id] = { ...e.artifact };
      const t = state.tasks[e.artifact.taskId];
      if (t && !t.artifacts.includes(e.artifact.id)) t.artifacts.push(e.artifact.id);
      break;
    }
    case 'test_run_recorded': {
      const tr = e.testRun;
      state.testRuns[tr.id] = { ...tr };
      if (tr.supersedes) {
        const old = state.testRuns[tr.supersedes];
        if (old) old.supersededBy = tr.id;
      }
      const t = state.tasks[tr.taskId];
      if (t && !t.testRuns.includes(tr.id)) t.testRuns.push(tr.id);
      // 测试证据同时挂到相关任务（集成/E2E 属于触发它的任务链）
      break;
    }
    case 'gate_result': {
      state.gates.push({ gate: e.gate, passed: e.passed, detail: e.detail, at: env.at, testRunId: e.testRunId, taskId: e.taskId });
      break;
    }
    case 'change_requested': {
      state.changeRequests[e.cr.id] = { ...e.cr };
      break;
    }
    case 'change_analyzed': {
      state.changeRequests[e.cr.id] = { ...e.cr };
      break;
    }
    case 'delivery_packaged': {
      state.delivery = e.delivery;
      state.deliveries.push(e.delivery);
      break;
    }
    case 'log': break;
  }
  return state;
}

/** 重放全部事件，重建状态（崩溃恢复 / 回放测试） */
export function rebuild(envelopes: readonly Envelope[]): ProjectState {
  let s = initialState();
  for (const env of envelopes) s = applyEvent(s, env);
  return s;
}
