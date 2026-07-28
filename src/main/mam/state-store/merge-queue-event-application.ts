import { MergeQueueEntrySchema, type MergeQueueEntry } from '../../../shared/mam/domain/merge-queue'
import type { SchedulerEvent } from '../../../shared/mam/scheduler-protocol'
import type {
  MergeConflictResolution,
  MergeConflictTaskDefinition
} from '../../../shared/mam/domain/merge-conflict-task'
import { MergeQueue } from '../application/merge-queue-service'
import { GitEventApplicationError } from './git-event-application-error'
import type { AttemptProjection, TaskProjection } from './git-state-projection'

type MergeQueueEvent = Extract<
  SchedulerEvent,
  {
    type:
      | 'merge_ready_recorded'
      | 'merge_entry_claimed'
      | 'merge_outcome_recorded'
      | 'merge_entry_superseded'
      | 'merge_conflict_resolution_recorded'
  }
>

export function applyMergeQueueEvent(input: {
  event: MergeQueueEvent
  tasks: Record<string, TaskProjection>
  entries: Record<string, MergeQueueEntry>
  conflictTasks: Record<string, MergeConflictTaskDefinition>
  conflictResolutions: Record<string, MergeConflictResolution>
  attempts: Record<string, AttemptProjection>
}): void {
  const { event, tasks, entries, conflictTasks, conflictResolutions, attempts } = input
  if (event.type === 'merge_ready_recorded') {
    const task = requireTask(tasks, event.taskId)
    if (entries[event.entry.id]) fail('duplicate_merge_entry', 'Merge Queue entry already exists')
    if (
      event.entry.workflowRunId !== event.workflowRunId ||
      event.entry.taskId !== event.taskId ||
      event.entry.status !== 'queued'
    ) {
      fail('merge_entry_mismatch', 'Merge Queue entry does not match its event envelope')
    }
    entries[event.entry.id] = event.entry
    tasks[event.taskId] = {
      ...task,
      status: 'completed',
      submittedCommit: event.entry.submittedCommit,
      mergeReadyAt: event.entry.mergeReadyAt,
      lastEventId: event.eventId
    }
    return
  }

  const entryId =
    event.type === 'merge_conflict_resolution_recorded'
      ? event.resolution.queueEntryId
      : event.entryId
  const entry = entries[entryId]
  if (!entry) fail('merge_entry_not_found', 'Merge Queue entry was not found')
  if (event.type === 'merge_conflict_resolution_recorded') {
    applyConflictResolution({
      event,
      entry,
      entries,
      conflictTasks,
      conflictResolutions,
      tasks,
      attempts
    })
    return
  }
  if (event.type === 'merge_entry_claimed') {
    const claimed = MergeQueue.create(Object.values(entries)).claimNext(event.claimedAt).entry
    if (!claimed || claimed.id !== event.entryId) {
      fail('merge_queue_order_violation', 'Event does not claim the first queued entry')
    }
    entries[event.entryId] = claimed
    return
  }
  if (event.type === 'merge_entry_superseded') {
    if (entry.status !== 'queued') fail('merge_entry_not_queued', 'Merge entry is not queued')
    entries[event.entryId] = MergeQueueEntrySchema.parse({
      ...entry,
      status: 'superseded',
      supersededByCommit: event.replacementCommit,
      supersededAt: event.supersededAt
    })
    return
  }
  if (entry.status !== 'merging') fail('merge_entry_not_active', 'Merge entry is not active')
  if (event.outcome.status === 'merged') {
    entries[event.entryId] = MergeQueueEntrySchema.parse({
      ...entry,
      status: 'merged',
      mergeCommit: event.outcome.mergeCommit,
      completedAt: event.outcome.completedAt
    })
  } else if (event.outcome.status === 'conflict') {
    const conflictTask = event.outcome.conflictTask
    if (conflictTasks[conflictTask.id]) {
      fail('duplicate_merge_conflict_task', 'Merge conflict Task already exists')
    }
    if (
      conflictTask.workflowRunId !== entry.workflowRunId ||
      conflictTask.queueEntryId !== entry.id ||
      conflictTask.parentTaskId !== entry.taskId ||
      conflictTask.parentAttemptId !== entry.attemptId ||
      conflictTask.submittedCommit !== entry.submittedCommit
    ) {
      fail('merge_conflict_lineage_mismatch', 'Merge conflict Task targets another ready revision')
    }
    conflictTasks[conflictTask.id] = conflictTask
    entries[event.entryId] = MergeQueueEntrySchema.parse({
      ...entry,
      status: 'conflict',
      conflictTaskId: conflictTask.id,
      detectedAt: conflictTask.createdAt
    })
  } else {
    entries[event.entryId] = MergeQueueEntrySchema.parse({
      ...entry,
      status: 'failed',
      failureReason: event.outcome.reason,
      completedAt: event.outcome.completedAt
    })
  }
}

function applyConflictResolution(input: {
  event: Extract<SchedulerEvent, { type: 'merge_conflict_resolution_recorded' }>
  entry: MergeQueueEntry
  entries: Record<string, MergeQueueEntry>
  conflictTasks: Record<string, MergeConflictTaskDefinition>
  conflictResolutions: Record<string, MergeConflictResolution>
  tasks: Record<string, TaskProjection>
  attempts: Record<string, AttemptProjection>
}): void {
  const { event, entry, conflictTasks, conflictResolutions, tasks, attempts } = input
  const resolution = event.resolution
  const conflictTask = conflictTasks[resolution.conflictTaskId]
  const task = tasks[event.taskId]
  const attempt = attempts[event.attemptId]
  if (
    entry.status !== 'conflict' ||
    entry.conflictTaskId !== resolution.conflictTaskId ||
    !conflictTask ||
    conflictTask.queueEntryId !== entry.id ||
    event.taskId !== resolution.conflictTaskId ||
    event.attemptId !== resolution.resolutionAttemptId ||
    !task ||
    task.status !== 'submitted' ||
    !attempt ||
    attempt.taskId !== event.taskId ||
    attempt.status !== 'submitted' ||
    attempt.result?.system.submittedCommit !== resolution.mergeCommit
  ) {
    fail('merge_resolution_mismatch', 'Resolution lacks a matching submitted conflict Attempt')
  }
  if (conflictResolutions[resolution.id]) {
    fail('duplicate_merge_resolution', 'Merge conflict Resolution already exists')
  }
  if (
    JSON.stringify(Object.keys(resolution.validationEvidence).sort()) !==
    JSON.stringify([...conflictTask.validationCommands].sort())
  ) {
    fail('merge_validation_incomplete', 'Resolution validation evidence is incomplete')
  }
  conflictResolutions[resolution.id] = resolution
  input.entries[entry.id] = MergeQueueEntrySchema.parse({
    ...entry,
    status: 'merged',
    resolutionAttemptId: resolution.resolutionAttemptId,
    mergeCommit: resolution.mergeCommit,
    completedAt: resolution.completedAt
  })
  tasks[event.taskId] = { ...task, status: 'completed', lastEventId: event.eventId }
}

export function supersedeQueuedMergeEntries(input: {
  taskId: string
  replacementCommit: string | undefined
  supersededAt: string
  entries: Record<string, MergeQueueEntry>
}): void {
  if (!input.replacementCommit) return
  for (const [entryId, entry] of Object.entries(input.entries)) {
    if (
      entry.taskId === input.taskId &&
      entry.status === 'queued' &&
      entry.submittedCommit !== input.replacementCommit
    ) {
      input.entries[entryId] = MergeQueueEntrySchema.parse({
        ...entry,
        status: 'superseded',
        supersededByCommit: input.replacementCommit,
        supersededAt: input.supersededAt
      })
    }
  }
}

function requireTask(tasks: Record<string, TaskProjection>, taskId: string): TaskProjection {
  const task = tasks[taskId]
  if (!task) fail('task_not_assigned', `task ${taskId} is not assigned`)
  return task
}

function fail(code: string, message: string): never {
  throw new GitEventApplicationError(code, message)
}
