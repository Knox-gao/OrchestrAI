import { describe, expect, it } from 'vitest';
import { canTransition, IllegalTransitionError, transition, depsSatisfied } from '../src/machine';
import type { Task } from '../src/types';

function mkTask(over: Partial<Task> = {}): Task {
  return {
    id: 'T1', title: '示例任务', kind: 'frontend', role: 'frontend',
    status: 'pending', dependsOn: [], requirementVersionId: 'RV-1',
    inputs: [], outputs: [], artifacts: [], testRuns: [], attempts: 0,
    createdAt: 0, updatedAt: 0, ...over,
  };
}

describe('任务状态机', () => {
  it('正常路径：pending → in_progress → awaiting_review → done', () => {
    const t = mkTask();
    transition(t, 'in_progress', 1);
    transition(t, 'awaiting_review', 2);
    transition(t, 'done', 3);
    expect(t.status).toBe('done');
  });

  it('退回重做：awaiting_review → rework → in_progress', () => {
    const t = mkTask({ status: 'awaiting_review' });
    transition(t, 'rework', 1);
    transition(t, 'in_progress', 2);
    expect(t.status).toBe('in_progress');
  });

  it('回归重开：done → rework（附原因）', () => {
    const t = mkTask({ status: 'done' });
    transition(t, 'rework', 1, '回归 reopen：E2E 缺陷');
    expect(t.status).toBe('rework');
  });

  it('done 之后不允许回到执行态（防假完成）', () => {
    expect(canTransition('done', 'in_progress')).toBe(false);
    expect(canTransition('done', 'pending')).toBe(false);
    const t = mkTask({ status: 'done' });
    expect(() => transition(t, 'in_progress', 1)).toThrow(IllegalTransitionError);
  });

  it('非法迁移全部被拒绝', () => {
    expect(canTransition('pending', 'done')).toBe(false); // 不允许跳过执行直接完成
    expect(canTransition('pending', 'awaiting_review')).toBe(false);
    expect(canTransition('rework', 'done')).toBe(false); // 重做必须重新执行
  });

  it('阻塞必须携带可见原因，解除后清除', () => {
    const t = mkTask({ status: 'in_progress' });
    transition(t, 'blocked', 1, '缺少数据库权限');
    expect(t.blockingReason).toBe('缺少数据库权限');
    transition(t, 'in_progress', 2);
    expect(t.blockingReason).toBeUndefined();
  });

  it('依赖满足判断', () => {
    const tasks: Record<string, Task> = {
      A: mkTask({ id: 'A', status: 'done' }),
      B: mkTask({ id: 'B', status: 'in_progress' }),
    };
    const t = mkTask({ dependsOn: ['A'] });
    expect(depsSatisfied(t, tasks)).toBe(true);
    const t2 = mkTask({ dependsOn: ['A', 'B'] });
    expect(depsSatisfied(t2, tasks)).toBe(false);
  });
});
