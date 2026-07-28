import {
  EMPTY_SCHEDULER_REVISION,
  SchedulerEventSchema,
  type SchedulerEvent
} from '../../../shared/mam/scheduler-protocol'
import { applyEvent } from './git-event-application'
import { GitEventApplicationError } from './git-event-application-error'
import { emptyWorkflowRunProjection, type WorkflowRunProjection } from './git-state-projection'
import { hashOrderedEvents, withProjectionHash } from './git-state-stable-hash'

export { GitEventApplicationError as GitEventProjectionError }
export {
  emptyWorkflowRunProjection,
  listTasksForRole,
  schedulerContextFromProjection,
  type AttemptProjection,
  type ProjectedTaskStatus,
  type TaskProjection,
  type WorkflowRunProjection
} from './git-state-projection'

export function replayWorkflowRun(
  workflowRunId: string,
  inputEvents: readonly unknown[]
): WorkflowRunProjection {
  const events = orderEventsByParent(inputEvents.map((input) => SchedulerEventSchema.parse(input)))
  const eventIds = new Set<string>()
  const commandIds = new Set<string>()
  let projection = emptyWorkflowRunProjection(workflowRunId)
  for (const event of events) {
    if (event.workflowRunId !== workflowRunId)
      fail('run_binding_mismatch', 'event targets another run')
    if (eventIds.has(event.eventId)) fail('duplicate_event_id', `duplicate event ${event.eventId}`)
    if (commandIds.has(event.commandId))
      fail('duplicate_command_id', `duplicate command ${event.commandId}`)
    eventIds.add(event.eventId)
    commandIds.add(event.commandId)
    projection = withProjectionHash(applyEvent(projection, event))
  }
  return withProjectionHash({
    ...projection,
    revision: hashOrderedEvents(events),
    eventIds: events.map((event) => event.eventId),
    commandIds: events.map((event) => event.commandId),
    lastEventAt: events.at(-1)?.createdAt ?? projection.lastEventAt
  })
}

function orderEventsByParent(events: readonly SchedulerEvent[]): SchedulerEvent[] {
  const known = new Map<string, ReadonlySet<string>>([[EMPTY_SCHEDULER_REVISION, new Set()]])
  const pending = [...events]
  const ordered: SchedulerEvent[] = []
  while (pending.length > 0) {
    const ready = pending.filter((event) => known.has(event.parentRevision)).sort(compareEvents)
    if (ready.length === 0) fail('parent_revision_mismatch', 'event references an unknown revision')
    for (const event of ready) {
      pending.splice(pending.indexOf(event), 1)
      const ids = new Set([...(known.get(event.parentRevision) ?? []), event.eventId])
      const ancestors = events.filter((candidate) => ids.has(candidate.eventId)).sort(compareEvents)
      known.set(hashOrderedEvents(ancestors), ids)
      ordered.push(event)
    }
    known.set(hashOrderedEvents(ordered), new Set(ordered.map((event) => event.eventId)))
  }
  return ordered
}

function compareEvents(left: SchedulerEvent, right: SchedulerEvent): number {
  return left.createdAt.localeCompare(right.createdAt) || left.eventId.localeCompare(right.eventId)
}

function fail(code: string, message: string): never {
  throw new GitEventApplicationError(code, message)
}
