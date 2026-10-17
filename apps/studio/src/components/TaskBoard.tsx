import {
  KANBAN_COLUMNS, ROLE_LABELS, kanbanOf,
  type ProjectState, type Task,
} from '@studio/core';

function cardClass(t: Task): string {
  const base = ['task-card'];
  base.push(kanbanOf(t.status));
  if (t.attempts > 1) base.push('rework');
  if (t.status === 'in_progress' && t.attempts > 1) base.push('active');
  return base.join(' ');
}

export function TaskBoard({
  state, selectedTaskId, onSelectTask,
}: {
  state: ProjectState;
  selectedTaskId: string | null;
  onSelectTask: (id: string) => void;
}) {
  const tasks = Object.values(state.tasks);
  return (
    <aside className="board">
      {KANBAN_COLUMNS.map((col) => {
        const items = tasks.filter((t) => kanbanOf(t.status) === col.key);
        return (
          <div className="kcol" key={col.key}>
            <h3>
              {col.label} <span className="count">({items.length})</span>
            </h3>
            {items.map((t) => (
              <div
                key={t.id}
                className={`${cardClass(t)} ${selectedTaskId === t.id ? 'selected' : ''}`}
                onClick={() => onSelectTask(t.id)}
                title={t.blockingReason ?? t.title}
              >
                <div>
                  <span className="tid">{t.id}</span>
                  {t.attempts > 1 && <span className="tid">×{t.attempts}</span>}
                  <span className="title">{t.title}</span>
                </div>
                <div className="meta">
                  <span>{ROLE_LABELS[t.role]}</span>
                  {t.dependsOn.length > 0 && <span>← {t.dependsOn.join(',')}</span>}
                  {t.blockingReason && <span style={{ color: 'var(--amber)' }}>⚠ {t.blockingReason}</span>}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </aside>
  );
}
