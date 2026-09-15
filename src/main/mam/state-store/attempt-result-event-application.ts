import type { MergeQueueEntry } from '../../../shared/mam/domain/merge-queue'
import type { SchedulerEvent } from '../../../shared/mam/scheduler-protocol'
import { supersedeQueuedMergeEntries } from './merge-queue-event-application'
import type { AttemptProjection, TaskProjection } from './git-state-projection'
import { blockUnconsumedRecoveryPlans } from './attempt-recovery-plan-state'
import { invalidateReviewsForNewAttempt, type ReviewValidity } from './review-event-application'
import type { ReviewDecision } from '../../../shared/mam/domain/review'
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
  reviews: Readonly<Record<string, ReviewDecision>>
  reviewValidity: Record<string, ReviewValidity>
  mergeQueueEntries: Record<string, MergeQueueEntry>
}): void {
  const { event, tasks, attempts, reviews, reviewValidity, mergeQueueEntries } = input
  const task = requireProjectedTask(tasks, event.taskId)
  const attempt = requireProjectedAttempt(attempts, event.attemptId, event.taskId)
  if (task.status === 'needs_attention' || attempt.status !== 'running') {
    failGitEventApplication('stale_attempt', 'Attempt can no longer submit a result')
  }
  const status = event.result.status === 'blocked' ? 'blocked' : 'submitted'
  if (status === 'submitted') {
    blockUnconsumedRecoveryPlans({ task, attempts, eventId: event.eventId })
  }
  const replacesSelectedAttempt =
    status === 'submitted' &&
    Boolean(task.selectedAttemptId) &&
    task.selectedAttemptId !== event.attemptId
  if (replacesSelectedAttempt) {
    invalidateReviewsForNewAttempt({
      taskId: event.taskId,
      attemptId: event.attemptId,
      reviews,
      validity: reviewValidity
    })
  }
  attempts[event.attemptId] = {
    ...attempt,
    status,
    result: event.result,
    lastEventId: event.eventId
  }
  const { reviewPanelId: _reviewPanelId, ...taskWithoutReviewPanel } = task
  tasks[event.taskId] = updateProjectedTask(
    replacesSelectedAttempt ? taskWithoutReviewPanel : task,
    event,
    {
      status,
      activeAttemptIds: task.activeAttemptIds.filter((id) => id !== event.attemptId),
      ...(status === 'submitted' ? { selectedAttemptId: event.attemptId } : {}),
      ...(event.result.system.submittedCommit
        ? { submittedCommit: event.result.system.submittedCommit }
        : {})
    }
  )
  supersedeQueuedMergeEntries({
    taskId: event.taskId,
    replacementCommit: event.result.system.submittedCommit,
    supersededAt: event.createdAt,
    entries: mergeQueueEntries
  })
}
