/**
 * 开工前确认（内测版核心交互）：AI 需要主观审美选择时，先问用户，而不是替用户拍板。
 * 用户在 HomePage 点「创建」→ App 调 /api/preflight → 若有问题弹本组件 → 选完才真正生成。
 */
import { useState } from 'react';

export interface ChoiceOption { value: string; label: string; hint?: string }
export interface ChoiceQuestion { id: string; title: string; reason?: string; options: ChoiceOption[] }

export function ChoiceModal({
  questions, onConfirm, onCancel, busy,
}: {
  questions: ChoiceQuestion[];
  onConfirm: (answers: Record<string, string>) => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const allAnswered = questions.every((q) => answers[q.id]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(3,5,10,.78)',
      display: 'grid', placeItems: 'center', backdropFilter: 'blur(6px)', padding: 20,
    }}>
      <div style={{
        width: 'min(620px, 94vw)', maxHeight: '86vh', overflowY: 'auto',
        background: 'var(--panel, #12151f)', border: '1px solid var(--border, #2a3354)',
        borderRadius: 14, padding: '22px 24px', boxShadow: '0 24px 80px rgba(0,0,0,.6)',
      }}>
        <div style={{ fontSize: 10.5, letterSpacing: 3, color: 'var(--cyan, #7dd3fc)', marginBottom: 8 }}>
          AI 需要一个决定 —— 开工前确认
        </div>
        <h2 style={{ fontSize: 19, margin: '0 0 6px' }}>有几个审美选择需要你拍板</h2>
        <p style={{ fontSize: 12.5, color: 'var(--text-dim)', margin: '0 0 18px', lineHeight: 1.7 }}>
          这些是主观选择，AI 不该替你猜。选完即开始生成；也可以选「让你决定」交给 AI。
        </p>

        {questions.map((q) => (
          <div key={q.id} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 3 }}>{q.title}</div>
            {q.reason && (
              <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginBottom: 9 }}>{q.reason}</div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {q.options.map((o) => {
                const on = answers[q.id] === o.value;
                return (
                  <button
                    key={o.value}
                    onClick={() => setAnswers((a) => ({ ...a, [q.id]: o.value }))}
                    title={o.hint}
                    style={{
                      flex: '1 1 140px', textAlign: 'left', padding: '10px 13px', cursor: 'pointer',
                      background: on ? 'rgba(125,211,252,.16)' : 'var(--panel-2, #1e2440)',
                      border: `1px solid ${on ? 'var(--cyan, #7dd3fc)' : 'var(--border, #2a3354)'}`,
                      borderRadius: 9, color: 'inherit',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: on ? 600 : 400 }}>{o.label}</div>
                    {o.hint && <div style={{ fontSize: 10.5, color: 'var(--text-faint)', marginTop: 3 }}>{o.hint}</div>}
                  </button>
                );
              })}
              <button
                onClick={() => setAnswers((a) => ({ ...a, [q.id]: '__ai_decide__' }))}
                style={{
                  flex: '0 0 auto', padding: '10px 13px', cursor: 'pointer',
                  background: answers[q.id] === '__ai_decide__' ? 'rgba(125,211,252,.16)' : 'transparent',
                  border: `1px dashed ${answers[q.id] === '__ai_decide__' ? 'var(--cyan, #7dd3fc)' : 'var(--border, #2a3354)'}`,
                  borderRadius: 9, color: 'var(--text-dim)', fontSize: 12,
                }}
              >
                让你决定
              </button>
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
          <button onClick={onCancel} disabled={busy} style={{
            background: 'none', border: '1px solid var(--border, #2a3354)', color: 'var(--text-dim)',
            borderRadius: 9, padding: '10px 18px', cursor: 'pointer', fontSize: 13,
          }}>取消</button>
          <button onClick={() => onConfirm(answers)} disabled={!allAnswered || busy} style={{
            background: allAnswered ? 'var(--cyan, #7dd3fc)' : 'rgba(125,211,252,.2)',
            border: 'none', color: allAnswered ? '#04121c' : 'var(--text-faint)',
            borderRadius: 9, padding: '10px 22px', cursor: allAnswered ? 'pointer' : 'default',
            fontSize: 13, fontWeight: 600,
          }}>{busy ? '开工中…' : '确定并开始生成'}</button>
        </div>
      </div>
    </div>
  );
}
