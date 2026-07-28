import { createHash } from 'node:crypto'
import {
  EMPTY_SCHEDULER_REVISION,
  type SchedulerEvent
} from '../../../shared/mam/scheduler-protocol'
import type { WorkflowRunProjection } from './git-state-projection'

export function hashOrderedEvents(events: readonly SchedulerEvent[]): string {
  if (events.length === 0) return EMPTY_SCHEDULER_REVISION
  return sha256(JSON.stringify(events))
}

export function withProjectionHash(
  projection: Omit<WorkflowRunProjection, 'stateHash'> | WorkflowRunProjection
): WorkflowRunProjection {
  const value: Record<string, unknown> = { ...projection }
  delete value.stateHash
  return { ...value, stateHash: sha256(stableStringify(value)) } as WorkflowRunProjection
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(',')}}`
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
