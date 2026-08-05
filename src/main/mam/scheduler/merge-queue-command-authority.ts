import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import { MergeQueue } from '../application/merge-queue-service'
import type { SchedulerKernelContext, SchedulerTaskContext } from './scheduler-command-authority'
import { SchedulerCommandRejectedError } from './scheduler-command-rejection'

type GlobalMergeCommand = Extract<
  SchedulerCommand,
  { type: 'claim_merge_entry' | 'record_merge_outcome' | 'supersede_merge_entry' }
>

export function assertGlobalMergeQueueAuthority(
  command: GlobalMergeCommand,
  context: SchedulerKernelContext
): void {
  assertScheduler(command, context.schedulerId)
  const entries = [...context.mergeQueueEntries.values()]
  if (command.type === 'claim_merge_entry') {
    if (entries.some((entry) => entry.status === 'merging')) {
      reject('merge_already_running', 'Merge Queue already has an active entry')
    }
    const next = MergeQueue.create(entries)
      .list()
      .find((entry) => entry.status === 'queued')
    if (!next || next.id !== command.entryId) {
      reject('merge_queue_order_violation', 'Command does not claim the first queued entry')
    }
    return
  }
  const entry = context.mergeQueueEntries.get(command.entryId)
  if (!entry) reject('merge_entry_not_found', 'Merge Queue entry was not found')
  if (command.type === 'supersede_merge_entry') {
    if (entry.status !== 'queued') {
      reject('merge_entry_not_queued', 'Only a queued entry can be superseded')
    }
    return
  }
  if (entry.status !== 'merging') {
    reject('merge_entry_not_active', 'Merge outcome requires an active entry')
  }
  if (command.outcome.status === 'conflict') {
    const task = command.outcome.conflictTask
    if (
      task.workflowRunId !== entry.workflowRunId ||
      task.mergeNodeId !== entry.mergeNodeId ||
      task.queueEntryId !== entry.id ||
      task.parentTaskId !== entry.taskId ||
      task.parentAttemptId !== entry.attemptId ||
      task.submittedCommit !== entry.submittedCommit
    ) {
      reject('merge_conflict_lineage_mismatch', 'Conflict Task targets another ready revision')
    }
  }
}

export function assertMergeReadyAuthority(
  command: Extract<SchedulerCommand, { type: 'mark_merge_ready' }>,
  task: SchedulerTaskContext,
  context: SchedulerKernelContext
): void {
  assertScheduler(command, context.schedulerId)
  if (task.status !== 'approved' && task.status !== 'completed') {
    reject('review_required', 'Merge readiness requires an approved Task revision')
  }
  if (
    command.entry.taskId !== command.taskId ||
    !task.mergeCandidate ||
    JSON.stringify(command.entry) !== JSON.stringify(task.mergeCandidate)
  ) {
    reject('merge_entry_mismatch', 'Merge Queue entry does not match current Task evidence')
  }
  if (context.mergeQueueEntries.has(command.entry.id)) {
    reject('duplicate_merge_entry', 'Merge Queue entry already exists')
  }
}

export function assertMergeConflictResolutionAuthority(
  command: Extract<SchedulerCommand, { type: 'record_merge_conflict_resolution' }>,
  task: SchedulerTaskContext,
  context: SchedulerKernelContext
): void {
  assertScheduler(command, context.schedulerId)
  if (
    task.status !== 'submitted' ||
    !task.submittedAttemptIds.has(command.attemptId) ||
    command.taskId !== command.resolution.conflictTaskId ||
    command.attemptId !== command.resolution.resolutionAttemptId ||
    !task.mergeResolutionCandidate ||
    JSON.stringify(command.resolution) !== JSON.stringify(task.mergeResolutionCandidate)
  ) {
    reject('merge_resolution_mismatch', 'Resolution does not match the submitted conflict Attempt')
  }
  const entry = context.mergeQueueEntries.get(command.resolution.queueEntryId)
  if (
    !entry ||
    entry.status !== 'conflict' ||
    entry.conflictTaskId !== command.taskId ||
    entry.workflowRunId !== command.resolution.workflowRunId
  ) {
    reject('merge_conflict_lineage_mismatch', 'Resolution targets another Merge Queue conflict')
  }
}

function assertScheduler(command: SchedulerCommand, schedulerId: string): void {
  if (command.actor.kind !== 'scheduler' || command.actor.schedulerId !== schedulerId) {
    reject('scheduler_authority_required', 'Command requires the active Scheduler identity')
  }
}

function reject(code: string, message: string): never {
  throw new SchedulerCommandRejectedError(code, message)
}
