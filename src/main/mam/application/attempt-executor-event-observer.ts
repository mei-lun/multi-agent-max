import type { ExecutorEvent } from '../../../shared/mam/executor-events'
import type { PreparedAttemptRunnerInput } from './mam-attempt-background-runner'
import { recordAttemptRunnerEvent } from './attempt-runner-diagnostics'

const MESSAGE_IDLE_FLUSH_MS = 5_000
const MESSAGE_MAX_BATCH_MS = 30_000

export class AttemptExecutorEventObserver {
  private liveEventCount = 0
  private pendingText = ''
  private pendingEvent: ExecutorEvent | undefined
  private idleFlushTimer: ReturnType<typeof setTimeout> | undefined
  private maxBatchTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly input: PreparedAttemptRunnerInput) {}

  observe = (event: ExecutorEvent): void => {
    this.liveEventCount += 1
    const streamingUpdate =
      event.type === 'agent_message' && event.sourceEventType === 'message_update'
    const text = streamingUpdate ? eventText(event.payload) : undefined
    if (text) {
      this.pendingText += text
      this.pendingEvent = event
      if (this.idleFlushTimer) clearTimeout(this.idleFlushTimer)
      this.idleFlushTimer = setTimeout(() => this.flush(), MESSAGE_IDLE_FLUSH_MS)
      this.maxBatchTimer ??= setTimeout(() => this.flush(), MESSAGE_MAX_BATCH_MS)
      return
    }
    if (streamingUpdate) return
    this.flush()
    this.record(event)
  }

  recordReturned(events: readonly ExecutorEvent[]): void {
    this.flush()
    if (this.liveEventCount > 0) return
    for (const event of events) this.record(event)
  }

  flush(): void {
    if (this.idleFlushTimer) clearTimeout(this.idleFlushTimer)
    if (this.maxBatchTimer) clearTimeout(this.maxBatchTimer)
    this.idleFlushTimer = undefined
    this.maxBatchTimer = undefined
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
  const update = nestedRecord(payload, 'assistantMessageEvent')
  if (update?.type !== 'text_delta') return undefined
  return nestedString(update, ['textDelta', 'delta', 'text'])
}

function nestedRecord(value: unknown, key: string, depth = 0): Record<string, unknown> | undefined {
  if (depth > 5 || !value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const candidate = record[key]
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    return candidate as Record<string, unknown>
  }
  for (const child of Object.values(record)) {
    const found = nestedRecord(child, key, depth + 1)
    if (found) return found
  }
  return undefined
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
