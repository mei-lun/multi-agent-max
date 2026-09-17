import type { ReviewAggregation, ReviewDecision } from '../../../shared/mam/domain/review'
import type { SchedulerEvent } from '../../../shared/mam/scheduler-protocol'
import type { TaskProjection, WorkflowRunProjection } from './git-state-projection'

export class ReviewAggregationEventError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'ReviewAggregationEventError'
  }
}

export function applyReviewAggregationEvent(input: {
  event: Extract<SchedulerEvent, { type: 'review_aggregation_recorded' }>
  tasks: Record<string, TaskProjection>
  reviews: Readonly<Record<string, ReviewDecision>>
  reviewValidity: Readonly<Record<string, Readonly<{ status: 'valid' | 'invalidated' }>>>
  aggregations: Record<string, ReviewAggregation>
}): void {
  const { event, tasks, reviews, reviewValidity, aggregations } = input
  const task = tasks[event.taskId]
  if (!task) fail('task_not_assigned', 'Review aggregation target Task is unavailable')
  if (
    event.aggregation.workflowRunId !== event.workflowRunId ||
    event.aggregation.subject.taskId !== event.taskId
  ) {
    fail('review_aggregation_binding_mismatch', 'Review aggregation targets another Task')
  }
  if (aggregations[event.aggregation.id]) {
    fail('duplicate_review_aggregation', 'Review aggregation already exists')
  }
  for (const decisionId of event.aggregation.sourceDecisionIds) {
    const decision = reviews[decisionId]
    if (
      !decision ||
      reviewValidity[decisionId]?.status !== 'valid' ||
      JSON.stringify(decision.subject) !== JSON.stringify(event.aggregation.subject)
    ) {
      fail('review_decision_invalid', 'Aggregation uses a missing, stale or unrelated Review')
    }
  }
  aggregations[event.aggregation.id] = event.aggregation
  const status = event.aggregation.requiresHumanDecision
    ? 'in_review'
    : event.aggregation.proposedStatus
  const { reviewPanelId: _reviewPanelId, ...taskWithoutReviewPanel } = task
  tasks[event.taskId] = {
    ...(event.aggregation.requiresHumanDecision ? task : taskWithoutReviewPanel),
    status,
    lastEventId: event.eventId
  }
}

export function applyReviewAggregateProjection(
  projection: WorkflowRunProjection,
  event: Extract<SchedulerEvent, { type: 'review_aggregate_recorded' }>
): WorkflowRunProjection {
  const tasks = { ...projection.tasks }
  const aggregations = { ...projection.reviewAggregations }
  applyReviewAggregationEvent({
    event: { ...event, type: 'review_aggregation_recorded' },
    tasks,
    reviews: projection.reviews,
    reviewValidity: projection.reviewValidity,
    aggregations
  })
  return { ...projection, tasks, reviewAggregations: aggregations }
}

function fail(code: string, message: string): never {
  throw new ReviewAggregationEventError(code, message)
}
