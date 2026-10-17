/**
 * 追加式事件日志 —— 唯一事实来源。
 * 项目状态永远可以由事件流完整重建（支持崩溃恢复与回放，见计划 P3/P6）。
 */
import type { Envelope, StudioEvent } from './events';

export class EventLog {
  private envelopes: Envelope[] = [];
  private nextSeq = 1;

  append(evt: StudioEvent, at?: number): Envelope {
    const env: Envelope = { seq: this.nextSeq++, at: at ?? this.now(), evt };
    this.envelopes.push(env);
    return env;
  }

  all(): readonly Envelope[] {
    return this.envelopes;
  }

  private now(): number {
    return Date.now();
  }
}
