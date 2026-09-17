import type { MergeQueueEntry } from '../../../shared/mam/domain/merge-queue'
import type { ReviewDecision } from '../../../shared/mam/domain/review'
import type { ReviewSubject } from '../../../shared/mam/domain/review'
import type { SchedulerEvent } from '../../../shared/mam/scheduler-protocol'
import { supersedeQueuedMergeEntries } from './merge-queue-event-application'
import {
  applyReviewRecordedEvent,
  invalidateReviewsForNewAttempt,
  type ReviewValidity
} from './review-event-application'
import type {
  AttemptProjection,
  TaskProjection,
  WorkflowRunProjection
} from './git-state-projection'
import {
  failGitEventApplication,
  requireProjectedTask,
  uniqueIds
} from './task-attempt-event-state'

export function applyTaskDeliveryEvent(input: {
  event: Extract<SchedulerEvent, { type: 'task_delivery_recorded' }>
  tasks: Record<string, TaskProjection>
  attempts: Record<string, AttemptProjection>
  reviews: Readonly<Record<string, ReviewDecision>>
  reviewValidity: Record<string, ReviewValidity>
  mergeQueueEntries: Record<string, MergeQueueEntry>
  reviewPanels: Readonly<
    Record<string, Readonly<{ subject: ReviewSubject; reviewTaskIds: readonly string[] }>>
  >
}): void {
  const { event, tasks, attempts, reviews, reviewValidity, mergeQueueEntries } = input
  const task = requireProjectedTask(tasks, event.taskId)
  const claim = task.activeClaim
  if (!claim || claim.claimId !== event.claimId || claim.generation !== event.generation) {
    failGitEventApplication('stale_claim', 'Task Claim generation is no longer active')
  }
  if (attempts[event.attemptId])
    failGitEventApplication('duplicate_attempt', 'Attempt already exists')
  attempts[event.attemptId] = {
    taskId: event.taskId,
    ...(event.previousDeliveredAttemptId
      ? { previousAttemptId: event.previousDeliveredAttemptId }
      : {}),
    status: event.result.status === 'blocked' ? 'blocked' : 'submitted',
    roleInstanceId: event.roleInstanceId,
    executorInvocationId: event.executorInvocationId,
    effectiveConfigSnapshotId: event.effectiveConfigSnapshotId,
    effectiveConfigHash: event.effectiveConfigHash,
    result: event.result,
    lastEventId: event.eventId
  }
  if (task.selectedAttemptId && task.selectedAttemptId !== event.attemptId) {
    invalidateReviewsForNewAttempt({
      taskId: event.taskId,
      attemptId: event.attemptId,
      reviews,
      validity: reviewValidity
    })
    for (const panel of Object.values(input.reviewPanels)) {
      if (panel.subject.taskId !== event.taskId || panel.subject.attemptId === event.attemptId)
        continue
      for (const reviewTaskId of panel.reviewTaskIds) {
        const reviewTask = tasks[reviewTaskId]
        if (!reviewTask || reviewTask.status === 'submitted') continue
        const { activeClaim: _claim, ...staleReviewTask } = reviewTask
        tasks[reviewTaskId] = {
          ...staleReviewTask,
          status: 'cancelled',
          lastEventId: event.eventId
        }
      }
    }
  }
  const { activeClaim: _claim, reviewPanelId: _panel, ...taskWithoutTransientState } = task
  tasks[event.taskId] = {
    ...taskWithoutTransientState,
    status: event.result.status === 'blocked' ? 'blocked' : 'submitted',
    activeAttemptIds: [],
    knownAttemptIds: uniqueIds([...task.knownAttemptIds, event.attemptId]),
    selectedAttemptId: event.attemptId,
    currentDeliveryAttemptId: event.attemptId,
    ...(event.result.system.submittedCommit
      ? { submittedCommit: event.result.system.submittedCommit }
      : {}),
    lastEventId: event.eventId
  }
  supersedeQueuedMergeEntries({
    taskId: event.taskId,
    replacementCommit: event.result.system.submittedCommit,
    supersededAt: event.createdAt,
    entries: mergeQueueEntries
  })
  if (event.review) {
    applyReviewRecordedEvent({
      event: { ...event, type: 'review_recorded', review: event.review },
      tasks,
      attempts,
      reviews: reviews as Record<string, ReviewDecision>,
      validity: reviewValidity
    })
  }
}

export function applyTaskDeliveryProjection(
  projection: WorkflowRunProjection,
  event: Extract<SchedulerEvent, { type: 'task_delivery_recorded' }>
): WorkflowRunProjection {
  const tasks = { ...projection.tasks }
  const attempts = { ...projection.attempts }
  const reviewValidity = { ...projection.reviewValidity }
  const mergeQueueEntries = { ...projection.mergeQueueEntries }
  applyTaskDeliveryEvent({
    event,
    tasks,
    attempts,
    reviews: projection.reviews,
    reviewValidity,
    mergeQueueEntries,
    reviewPanels: projection.reviewPanels
  })
  return { ...projection, tasks, attempts, reviewValidity, mergeQueueEntries }
}
