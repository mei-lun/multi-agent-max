import type { ExecutorEvent } from '../../../shared/mam/executor-events'

export type ExecutorEventListener = (event: ExecutorEvent) => void

export function emitObservedExecutorEvent(
  listener: ExecutorEventListener | undefined,
  event: ExecutorEvent
): void {
  try {
    listener?.(event)
  } catch {
    // Observability must not change executor completion semantics.
  }
}
