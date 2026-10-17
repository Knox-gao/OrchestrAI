/**
 * 交付门禁 —— 计划铁律：未通过门禁时不得标记为可交付。
 * deliveryBlockers 返回空数组才允许打包交付。
 */
import type { ProjectState } from './types';

export function deliveryBlockers(s: ProjectState): string[] {
  const blockers: string[] = [];

  for (const t of Object.values(s.tasks)) {
    if (t.status === 'blocked') {
      blockers.push(`任务 ${t.id}（${t.title}）阻塞中：${t.blockingReason ?? '原因未记录'}`);
    } else if (t.status !== 'done') {
      blockers.push(`任务 ${t.id}（${t.title}）未完成，当前状态：${t.status}`);
    }
  }

  // 未被重跑取代的失败测试 = 当前代码版本上仍然生效的失败证据
  for (const tr of Object.values(s.testRuns)) {
    if (tr.exitCode !== 0 && !tr.supersededBy) {
      blockers.push(`测试未通过且未被重跑取代：${tr.command}（退出码 ${tr.exitCode}，${tr.failed} 项失败，日志 ${tr.logPath}）`);
    }
  }

  for (const a of Object.values(s.approvals)) {
    if (a.status === 'pending' && (a.kind === 'delivery' || a.kind === 'change' || a.kind === 'high_risk')) {
      blockers.push(`等待用户决策：${a.subject}`);
    }
  }

  const acceptance = [...s.gates].reverse().find((g) => g.gate === 'acceptance');
  if (!acceptance || !acceptance.passed) {
    blockers.push('主管验收（acceptance）尚未通过');
  }

  return blockers;
}
