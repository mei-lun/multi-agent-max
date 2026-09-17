import type { ReviewDecision, ReviewSubject } from '../../../shared/mam/domain/review'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import { calculateReviewAggregation } from '../review/review-aggregation-calculator'
import { createReviewTasks } from '../review/review-fan-out-service'
import type { SchedulerKernelContext, SchedulerTaskContext } from './scheduler-command-authority'
import { SchedulerCommandRejectedError } from './scheduler-command-rejection'

export function assertReviewAggregationAuthority(
  command: Extract<SchedulerCommand, { type: 'record_review_aggregation' }>,
  task: SchedulerTaskContext,
  schedulerId: string
): void {
  assertScheduler(command, schedulerId)
  if (task.status !== 'in_review') {
    reject('review_not_collecting', 'Task is not collecting Review decisions')
  }
  const decisions = command.aggregation.sourceDecisionIds.map((id) => task.reviewDecisions.get(id))
  if (decisions.some((decision) => !decision)) {
    reject('review_decision_invalid', 'Aggregation references a missing or invalidated Review')
  }
  if (decisions.length < (task.minimumReviewDecisions ?? 1)) {
    reject('review_quorum_unmet', 'Review aggregation does not meet the configured quorum')
  }
  const expected = calculateReviewAggregation({
    decisions: decisions as ReviewDecision[],
    createdAt: command.aggregation.createdAt,
    formalRevisionNumber: task.formalRevisionNumber ?? 0,
    maxRevisionAttempts: task.maxRevisionAttempts ?? Number.MAX_SAFE_INTEGER
  })
  if (JSON.stringify(expected) !== JSON.stringify(command.aggregation)) {
    reject('review_aggregation_mismatch', 'Review aggregation is not deterministic')
  }
}

export function assertReviewPanelAuthority(
  command: Extract<SchedulerCommand, { type: 'create_review_panel' }>,
  task: SchedulerTaskContext,
  context: SchedulerKernelContext
): void {
  assertScheduler(command, context.schedulerId)
  if (task.status !== 'submitted' && task.status !== 'approved') {
    reject('review_subject_not_submitted', 'Review target Task is not submitted')
  }
  if (!task.reviewTarget || JSON.stringify(task.reviewTarget) !== JSON.stringify(command.subject)) {
    reject('review_binding_mismatch', 'Review panel does not target the latest immutable subject')
  }
  if (task.allowedReviewNodeIds && !task.allowedReviewNodeIds.has(command.reviewNodeId)) {
    reject('review_route_invalid', 'Review panel is outside the target Task route')
  }
  if (task.reviewPanelId) reject('review_panel_already_created', 'Review panel already exists')
  if (!context.runBundle) {
    reject('run_bundle_required', 'Review panel creation requires the authoritative Run Bundle')
  }
  createReviewTasks({
    bundle: context.runBundle,
    reviewNodeId: command.reviewNodeId,
    subject: command.subject,
    ...(context.existingTaskIds ? { existingTaskIds: context.existingTaskIds } : {})
  })
}

export function assertReviewDecisionBinding(input: {
  review: ReviewDecision | undefined
  workflowRunId: string
  reviewerTaskId: string
  reviewerAttemptId: string
  reviewerRoleInstanceId: string
  reviewTarget: ReviewSubject | undefined
  reviewNodeId: string | undefined
}): void {
  if (!input.reviewNodeId) {
    if (input.review && !input.reviewTarget) {
      reject('review_target_required', 'Reviewer Task has no Review subject')
    }
    if (input.review) reject('review_not_expected', 'Non-Reviewer Task cannot attach a Review')
    return
  }
  if (!input.reviewTarget) reject('review_target_required', 'Reviewer Task has no Review subject')
  const review = input.review
  if (!review) reject('review_required', 'Reviewer Delivery requires a Review decision')
  if (
    review.workflowRunId !== input.workflowRunId ||
    review.reviewerTaskId !== input.reviewerTaskId ||
    review.reviewerAttemptId !== input.reviewerAttemptId ||
    review.reviewerRoleInstanceId !== input.reviewerRoleInstanceId ||
    review.reviewNodeId !== input.reviewNodeId ||
    JSON.stringify(review.subject) !== JSON.stringify(input.reviewTarget)
  ) {
    reject('review_binding_mismatch', 'Review is not bound to its Reviewer Task and subject')
  }
}

function assertScheduler(command: SchedulerCommand, schedulerId: string): void {
  if (command.actor.kind !== 'scheduler' || command.actor.schedulerId !== schedulerId) {
    reject('scheduler_authority_required', 'command requires the active Scheduler identity')
  }
}

function reject(code: string, message: string): never {
  throw new SchedulerCommandRejectedError(code, message)
}
