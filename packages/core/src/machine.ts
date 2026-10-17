/**
 * 任务状态机 —— 显式、可审计的状态迁移（计划第八章：先用显式状态机，不做完全自治）。
 */
import type { Task, TaskStatus } from './types';

const ALLOWED: Record<TaskStatus, TaskStatus[]> = {
  pending: ['ready', 'in_progress', 'blocked'],
  ready: ['in_progress', 'blocked', 'pending'],
  in_progress: ['awaiting_review', 'blocked', 'pending'],
  awaiting_review: ['done', 'rework', 'blocked'],
  rework: ['in_progress', 'blocked'],
  blocked: ['pending', 'ready', 'in_progress', 'awaiting_review', 'rework'],
  // done 仅允许被"回归重开"（附原因），不允许直接回到执行态
  done: ['rework'],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED[from].includes(to);
}

export class IllegalTransitionError extends Error {
  constructor(from: TaskStatus, to: TaskStatus) {
    super(`非法状态迁移：${from} → ${to}`);
  }
}

export function transition(task: Task, to: TaskStatus, now: number, reason?: string): Task {
  if (task.status === to) return task;
  if (!canTransition(task.status, to)) throw new IllegalTransitionError(task.status, to);
  task.status = to;
  task.updatedAt = now;
  if (to === 'blocked') task.blockingReason = reason;
  else task.blockingReason = undefined;
  return task;
}

/** 依赖是否全部满足（依赖任务全部 done） */
export function depsSatisfied(task: Task, tasks: Record<string, Task>): boolean {
  return task.dependsOn.every((id) => tasks[id]?.status === 'done');
}
