import { describe, expect, it } from 'vitest';
import { StudioEngine } from '../src/engine';
import { createDemoScenario, DEMO_CHANGE_HINT } from '../src/scenario';
import { deliveryBlockers } from '../src/gates';
import { rebuild } from '../src/state';

function newEngine() {
  return new StudioEngine(createDemoScenario(), {
    autoApprove: true,
    autoChangeText: DEMO_CHANGE_HINT,
  });
}

describe('演示剧本端到端（全自动）', () => {
  const engine = newEngine();
  engine.runToCompletion();
  const s = engine.state;

  it('终态：v0.2.0 已交付，两次交付均有版本记录', () => {
    expect(engine.status).toBe('finished');
    expect(s.deliveries.map((d) => d.version)).toEqual(['0.1.0', '0.2.0']);
    expect(s.delivery?.version).toBe('0.2.0');
  });

  it('全部任务完成且可追踪（状态/负责人/产物/事件）', () => {
    const tasks = Object.values(s.tasks);
    expect(tasks.length).toBe(12); // v0.1: T1-T9, v0.2: T10-T12
    for (const t of tasks) {
      expect(t.status, `任务 ${t.id}`).toBe('done');
      expect(t.role).toBeTruthy();
      expect(t.attempts).toBeGreaterThanOrEqual(1);
    }
    const withArtifacts = tasks.filter((t) => t.artifacts.length > 0);
    expect(withArtifacts.length).toBeGreaterThan(6);
  });

  it('缺陷闭环：存在失败的 E2E 证据，且被修复后的重跑取代', () => {
    const fail = Object.values(s.testRuns).find((r) => r.id === 'TR-04');
    expect(fail).toBeDefined();
    expect(fail!.exitCode).toBe(1);
    expect(fail!.failed).toBe(2);
    expect(fail!.logPath).toBeTruthy(); // 证据必须落盘
    // 修复后被 TR-05 取代 → 不再构成交付阻断
    expect(fail!.supersededBy).toBe('TR-05');
    const rerun = s.testRuns['TR-05'];
    expect(rerun?.exitCode).toBe(0);
    expect(rerun?.supersedes).toBe('TR-04');
  });

  it('T5 被退回重做且 attempts = 2', () => {
    const t5 = s.tasks['T5']!;
    expect(t5.attempts).toBe(2);
    const reopen = engine.events.find(
      (e) => e.evt.type === 'task_status_changed' && e.evt.taskId === 'T5' && e.evt.to === 'rework',
    );
    expect(reopen).toBeDefined();
  });

  it('变更可追溯：CR-1 已实施，需求 v0.2 取代 v0.1 且历史保留', () => {
    const cr = s.changeRequests['CR-1']!;
    expect(cr.status).toBe('implemented');
    expect(cr.classification).toBe('major');
    expect(cr.impact!.tasks.length).toBe(3);
    expect(cr.impact!.budgetDelta).toBeTruthy();
    const v01 = s.requirementVersions['RV-1']!;
    const v02 = s.requirementVersions['RV-2']!;
    expect(v01.status).toBe('superseded'); // 不静默覆盖
    expect(v02.status).toBe('confirmed');
    expect(v02.supersedes).toBe('RV-1');
    expect(v02.userStories.length).toBe(4); // US4 优先级
  });

  it('回归铁律：v0.2 代码变化后 E2E 全量重跑并取代 v0.1 证据', () => {
    const tr05 = s.testRuns['TR-05']!;
    const tr08 = s.testRuns['TR-08']!;
    expect(tr08.exitCode).toBe(0);
    expect(tr08.supersedes).toBe('TR-05');
    expect(tr05.supersededBy).toBe('TR-08');
  });

  it('成本可观测：预算汇总与运行次数一致', () => {
    const runs = Object.values(s.agentRuns);
    const sum = runs.reduce((acc, r) => acc + (r.usage?.costUsd ?? 0), 0);
    expect(s.budget.spentUsd).toBeCloseTo(sum, 5);
    expect(s.budget.spentUsd).toBeGreaterThan(0.5);
    expect(s.budget.spentUsd).toBeLessThan(s.budget.capUsd);
  });

  it('事件流可完整重建状态（崩溃恢复）', () => {
    const rebuilt = rebuild(engine.events);
    expect(rebuilt.delivery?.version).toBe(s.delivery?.version);
    expect(Object.keys(rebuilt.tasks).sort()).toEqual(Object.keys(s.tasks).sort());
    expect(rebuilt.budget.spentUsd).toBeCloseTo(s.budget.spentUsd, 5);
  });
});

describe('交付门禁（铁律：失败时不得交付）', () => {
  const engine = newEngine();
  engine.runToCompletion();

  it('E2E 失败时刻：门禁阻断项非空，不可能交付', () => {
    // 在 TR-04 失败刚刚记录之后的时间点取样
    const idx = engine.history.findIndex((h) => h.testRuns['TR-04'] && !h.testRuns['TR-05']);
    expect(idx).toBeGreaterThan(0);
    const snapshot = engine.history[idx]!;
    const blockers = deliveryBlockers(snapshot);
    expect(blockers.length).toBeGreaterThan(0);
    expect(blockers.some((b) => b.includes('TR-04') || b.includes('测试未通过'))).toBe(true);
    // 此时尚未发生任何交付
    expect(snapshot.deliveries.length).toBe(0);
  });

  it('终态：阻断清零（旧失败已被取代）', () => {
    expect(deliveryBlockers(engine.state)).toEqual([]);
  });

  it('阻断项包含真实原因与日志位置（可定位）', () => {
    const idx = engine.history.findIndex((h) => h.testRuns['TR-04'] && !h.testRuns['TR-05']);
    const blockers = deliveryBlockers(engine.history[idx]!);
    const testBlocker = blockers.find((b) => b.includes('测试未通过'))!;
    expect(testBlocker).toContain('logs/e2e-001.log');
    expect(testBlocker).toContain('退出码 1');
  });
});

describe('审批分支', () => {
  it('驳回需求 → 主管修订并重新请求审批（v0.1.1）→ 通过后继续', () => {
    const engine = new StudioEngine(createDemoScenario(), {
      autoApprove: true,
      autoChangeText: DEMO_CHANGE_HINT,
    });
    engine.start();
    // 快进到第一个审批出现
    for (let i = 0; i < 500 && engine.status !== 'awaiting_approval'; i++) engine.tick(10_000);
    const first = engine.firstPendingApproval()!;
    expect(first.kind).toBe('requirement');
    engine.decideApproval(first.id, false, '假设清单需要补充');
    // 修订剧本需要播放到下一次审批暂停点
    for (let i = 0; i < 500 && engine.status !== 'awaiting_approval'; i++) engine.tick(10_000);
    expect(engine.state.requirementVersions['RV-1b']?.version).toBe('v0.1.1');
    engine.runToCompletion();
    expect(engine.state.deliveries.length).toBe(2);
    const confirmed = Object.values(engine.state.requirementVersions).filter((r) => r.status === 'confirmed');
    expect(confirmed.length).toBe(2); // RV-1b(v0.1.1) + RV-2(v0.2)
  });

  it('驳回变更 → 需求保持 v0.1，仅一次交付，无 v0.2 任务', () => {
    const engine = new StudioEngine(createDemoScenario(), {});
    engine.start();
    let guard = 0;
    while (engine.status !== 'finished' && guard++ < 2000) {
      if (engine.status === 'awaiting_approval') {
        const p = engine.firstPendingApproval()!;
        engine.decideApproval(p.id, p.kind !== 'change'); // 只拒绝变更，其余批准
      } else if (engine.status === 'awaiting_change') {
        engine.submitChange(DEMO_CHANGE_HINT);
      } else {
        engine.tick(10_000);
      }
    }
    expect(engine.status).toBe('finished');
    const s = engine.state;
    expect(s.deliveries.map((d) => d.version)).toEqual(['0.1.0']);
    expect(s.changeRequests['CR-1']!.status).toBe('rejected');
    expect(s.requirementVersions['RV-1']!.status).toBe('confirmed'); // 未被取代
    expect(s.requirementVersions['RV-2']).toBeUndefined();
    expect(s.tasks['T10']).toBeUndefined();
  });
});

describe('restoreSync（主页进入历史项目）', () => {
  it('从 cue 队列瞬时恢复终态，与逐帧回放一致', () => {
    const cues: import('../src/engine').Cue[] = [
      { d: 10, events: [{ type: 'project_created', projectId: 'P1', projectName: '恢复测试项目', workspace: 'workspaces/P1' }] },
      { d: 10, events: [{ type: 'plan_created', tasks: [{ id: 'T1', title: '唯一任务', kind: 'frontend', role: 'frontend', dependsOn: [], inputs: [], outputs: [] }], note: '' }] },
      { d: 10, events: [
        { type: 'task_status_changed', taskId: 'T1', from: 'pending', to: 'in_progress' },
        { type: 'task_status_changed', taskId: 'T1', from: 'in_progress', to: 'awaiting_review' },
        { type: 'task_status_changed', taskId: 'T1', from: 'awaiting_review', to: 'done' },
        { type: 'delivery_packaged', delivery: { version: '1.0.0', manifest: ['a'], knownLimits: [], testSummary: 'ok', packagedAt: 0 } },
        { type: 'phase_changed', phase: '已交付 1.0.0', status: 'delivered' },
      ] },
    ];
    const e = new StudioEngine(createDemoScenario());
    e.restoreSync(cues);
    expect(e.status).toBe('finished');
    expect(e.state.projectName).toBe('恢复测试项目');
    expect(e.state.delivery?.version).toBe('1.0.0');
    expect(e.state.tasks['T1']?.status).toBe('done');
    expect(e.events.length).toBe(cues.reduce((a, c) => a + (c.events?.length ?? 0), 0));
  });

  it('非 idle 状态下忽略重复恢复', () => {
    const e = new StudioEngine(createDemoScenario());
    e.restoreSync([{ d: 1, events: [{ type: 'log', level: 'info', message: 'x' }] }]);
    e.restoreSync([{ d: 1, events: [{ type: 'log', level: 'info', message: 'y' }] }]);
    expect(e.events.length).toBe(1);
  });
});

describe('通用变更（非优先级文本）', () => {
  it('任意文本也走完整 CR 流程：分析 → 审批 → 新版本 → 回归', () => {
    const engine = new StudioEngine(createDemoScenario(), {
      autoApprove: true,
      autoChangeText: '把主按钮换成圆角，标题字号调大一点',
    });
    engine.runToCompletion();
    const s = engine.state;
    const cr = s.changeRequests['CR-1']!;
    expect(cr.classification).toBe('minor');
    expect(cr.status).toBe('implemented');
    expect(s.requirementVersions['RV-2']).toBeDefined();
    expect(s.deliveries.map((d) => d.version)).toEqual(['0.1.0', '0.2.0']);
    // 低影响变更只生成 2 项新任务
    const newTasks = Object.values(s.tasks).filter((t) => ['T10', 'T11'].includes(t.id));
    expect(newTasks.length).toBe(2);
    expect(s.tasks['T12']).toBeUndefined();
  });
});
