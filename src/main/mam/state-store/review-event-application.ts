import type { ReviewDecision } from '../../../shared/mam/domain/review'
import type { SchedulerEvent } from '../../../shared/mam/scheduler-protocol'
import type { AttemptProjection, TaskProjection } from './git-state-projection'

type ReviewValidity = Readonly<{
  status: 'valid' | 'invalidated'
  invalidatedByAttemptId?: string
}>

export class ReviewEventApplicationError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'ReviewEventApplicationError'
  }
}

export function invalidateReviewsForNewAttempt(input: {
  taskId: string
  attemptId: string
  reviews: Readonly<Record<string, ReviewDecision>>
  validity: Record<string, ReviewValidity>
}): void {
  for (const review of Object.values(input.reviews)) {
    if (
      review.subject.taskId === input.taskId &&
      review.subject.attemptId !== input.attemptId &&
      input.validity[review.id]?.status !== 'invalidated'
    ) {
      input.validity[review.id] = {
        status: 'invalidated',
        invalidatedByAttemptId: input.attemptId
      }
    }
  }
}

export function applyReviewRecordedEvent(input: {
  event: Extract<SchedulerEvent, { type: 'review_recorded' }>
  tasks: Record<string, TaskProjection>
  attempts: Record<string, AttemptProjection>
  reviews: Record<string, ReviewDecision>
  validity: Record<string, ReviewValidity>
}): void {
  const { event, tasks, attempts, reviews, validity } = input
  if (
    event.review.workflowRunId !== event.workflowRunId ||
    event.review.reviewerTaskId !== event.taskId ||
    event.review.reviewerAttemptId !== event.attemptId
  ) {
    fail('review_binding_mismatch', 'Review event does not match its reviewer Attempt')
  }
  const reviewerTask = requireTask(tasks, event.taskId)
  const reviewerAttempt = requireAttempt(attempts, event.attemptId, event.taskId)
  const targetTask = requireTask(tasks, event.review.subject.taskId)
  const targetAttempt = requireAttempt(
    attempts,
    event.review.subject.attemptId,
    event.review.subject.taskId
  )
  const latestTargetAttemptId = targetTask.knownAttemptIds.at(-1)
  if (
    latestTargetAttemptId !== event.review.subject.attemptId ||
    targetAttempt.status !== 'submitted'
  ) {
    fail('stale_review_attempt', 'Review subject is not the latest submitted Attempt')
  }
  if (reviews[event.review.id]) fail('duplicate_review', 'review already exists')
  reviews[event.review.id] = event.review
  validity[event.review.id] = { status: 'valid' }
  attempts[event.attemptId] = {
    ...reviewerAttempt,
    status: 'submitted',
    lastEventId: event.eventId
  }
  tasks[event.taskId] = {
    ...reviewerTask,
    status: 'submitted',
    activeAttemptIds: reviewerTask.activeAttemptIds.filter((id) => id !== event.attemptId),
    reviewIds: unique([...reviewerTask.reviewIds, event.review.id]),
    lastEventId: event.eventId
  }
  tasks[event.review.subject.taskId] = {
    ...targetTask,
    status: 'in_review',
    reviewIds: unique([...targetTask.reviewIds, event.review.id]),
    lastEventId: event.eventId
  }
}

function requireTask(tasks: Record<string, TaskProjection>, taskId: string): TaskProjection {
  return tasks[taskId] ?? fail('task_not_assigned', `task ${taskId} is not assigned`)
}

function requireAttempt(
  attempts: Record<string, AttemptProjection>,
  attemptId: string,
  taskId: string
): AttemptProjection {
  const attempt = attempts[attemptId]
  if (!attempt || attempt.taskId !== taskId) {
    fail('attempt_not_found', 'attempt is not bound to task')
  }
  return attempt
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function fail(code: string, message: string): never {
  throw new ReviewEventApplicationError(code, message)
}
