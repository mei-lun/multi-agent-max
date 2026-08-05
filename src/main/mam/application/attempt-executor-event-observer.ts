import type { ExecutorEvent } from '../../../shared/mam/executor-events'
import type { PreparedAttemptRunnerInput } from './mam-attempt-background-runner'
import { recordAttemptRunnerEvent } from './attempt-runner-diagnostics'

const MESSAGE_FLUSH_INTERVAL_MS = 120

export class AttemptExecutorEventObserver {
  private liveEventCount = 0
  private pendingText = ''
  private pendingEvent: ExecutorEvent | undefined
  private flushTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly input: PreparedAttemptRunnerInput) {}

  observe = (event: ExecutorEvent): void => {
    this.liveEventCount += 1
    const text = event.type === 'agent_message' ? eventText(event.payload) : undefined
    if (text) {
      this.pendingText += text
      this.pendingEvent = event
      this.flushTimer ??= setTimeout(() => this.flush(), MESSAGE_FLUSH_INTERVAL_MS)
      return
    }
    this.flush()
    this.record(event)
  }

  recordReturned(events: readonly ExecutorEvent[]): void {
    this.flush()
    if (this.liveEventCount > 0) return
    for (const event of events) this.record(event)
  }

  flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = undefined
    if (!this.pendingEvent || !this.pendingText) return
    this.record({
      ...this.pendingEvent,
      sourceEventType: `${this.pendingEvent.sourceEventType}.batched`,
      payload: { textDelta: this.pendingText }
    })
    this.pendingEvent = undefined
    this.pendingText = ''
  }

  private record(event: ExecutorEvent): void {
    recordAttemptRunnerEvent(this.input, 'executor', { event })
  }
}

function eventText(payload: Readonly<Record<string, unknown>>): string | undefined {
  return nestedString(payload, ['textDelta', 'delta', 'text'])
}

function nestedString(value: unknown, keys: readonly string[], depth = 0): string | undefined {
  if (depth > 5 || !value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  for (const key of keys) {
    if (typeof record[key] === 'string') return record[key]
  }
  for (const child of Object.values(record)) {
    const found = nestedString(child, keys, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}
