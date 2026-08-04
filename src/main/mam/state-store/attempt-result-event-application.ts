import type { MergeQueueEntry } from '../../../shared/mam/domain/merge-queue'
import type { SchedulerEvent } from '../../../shared/mam/scheduler-protocol'
import { supersedeQueuedMergeEntries } from './merge-queue-event-application'
import type { AttemptProjection, TaskProjection } from './git-state-projection'
import { blockUnconsumedRecoveryPlans } from './attempt-recovery-plan-state'
import {
  failGitEventApplication,
  requireProjectedAttempt,
  requireProjectedTask,
  updateProjectedTask
} from './task-attempt-event-state'

export function applyAttemptResultSubmitted(input: {
  event: Extract<SchedulerEvent, { type: 'attempt_result_submitted' }>
  tasks: Record<string, TaskProjection>
  attempts: Record<string, AttemptProjection>
  mergeQueueEntries: Record<string, MergeQueueEntry>
}): void {
  const { event, tasks, attempts, mergeQueueEntries } = input
  const task = requireProjectedTask(tasks, event.taskId)
  const attempt = requireProjectedAttempt(attempts, event.attemptId, event.taskId)
  if (task.status === 'needs_attention' || attempt.status !== 'running') {
    failGitEventApplication('stale_attempt', 'Attempt can no longer submit a result')
  }
  const status = event.result.status === 'blocked' ? 'blocked' : 'submitted'
  if (status === 'submitted') {
    blockUnconsumedRecoveryPlans({ task, attempts, eventId: event.eventId })
  }
  attempts[event.attemptId] = {
    ...attempt,
    status,
    result: event.result,
    lastEventId: event.eventId
  }
  tasks[event.taskId] = updateProjectedTask(task, event, {
    status,
    activeAttemptIds: task.activeAttemptIds.filter((id) => id !== event.attemptId),
    ...(status === 'submitted' ? { selectedAttemptId: event.attemptId } : {}),
    ...(event.result.system.submittedCommit
      ? { submittedCommit: event.result.system.submittedCommit }
      : {})
  })
  supersedeQueuedMergeEntries({
    taskId: event.taskId,
    replacementCommit: event.result.system.submittedCommit,
    supersededAt: event.createdAt,
    entries: mergeQueueEntries
  })
}
