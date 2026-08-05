import type { ReviewSubject } from '../../../shared/mam/domain/review'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import { ReviewAggregationPolicy } from '../review/review-aggregation-policy'
import { boundedReviewStatus } from '../review/review-revision-limit'
import { GitCommandRetryCoordinator } from '../state-store/git-command-retry-coordinator'
import type { GitStateRepository } from '../state-store/git-state-repository'

export function publishReviewAggregationIfReady(input: {
  repository: GitStateRepository
  workflowRunId: string
  reviewNodeId: string
  subject: ReviewSubject
  schedulerId: string
  commandId: string
  issuedAt: string
}): boolean {
  const bundle = input.repository.loadRunBundle(input.workflowRunId)
  if (!bundle) throw new Error('run_bundle_missing')
  const projection = input.repository.rebuild(input.workflowRunId)
  const alreadyAggregated = Object.values(projection.reviewAggregations).some(
    (aggregation) =>
      aggregation.reviewNodeId === input.reviewNodeId &&
      JSON.stringify(aggregation.subject) === JSON.stringify(input.subject)
  )
  if (alreadyAggregated) return false
  const reviewNode = bundle.definition.nodes.find(
    (node) => node.id === input.reviewNodeId && node.type === 'review_gate'
  )
  if (!reviewNode || reviewNode.type !== 'review_gate') throw new Error('review_node_invalid')
  const decisions = Object.values(projection.reviews)
    .filter(
      (decision) =>
        decision.reviewNodeId === input.reviewNodeId &&
        projection.reviewValidity[decision.id]?.status === 'valid' &&
        JSON.stringify(decision.subject) === JSON.stringify(input.subject)
    )
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
    )
  if (decisions.length < reviewNode.minimumDecisions) return false
  const aggregation = new ReviewAggregationPolicy(() => input.issuedAt).aggregate(
    decisions
  ).aggregation
  const targetAttemptCount = projection.tasks[input.subject.taskId]?.knownAttemptIds.length ?? 1
  const boundedAggregation = {
    ...aggregation,
    proposedStatus: boundedReviewStatus({
      status: aggregation.proposedStatus,
      attemptCount: targetAttemptCount,
      maxRevisionAttempts: reviewNode.maxRevisionAttempts
    })
  }
  const command: Extract<SchedulerCommand, { type: 'record_review_aggregation' }> = {
    schemaVersion: '1.0.0',
    commandId: input.commandId,
    issuedAt: input.issuedAt,
    workflowRunId: input.workflowRunId,
    taskId: input.subject.taskId,
    actor: { kind: 'scheduler', schedulerId: input.schedulerId },
    type: 'record_review_aggregation',
    aggregation: boundedAggregation
  }
  new GitCommandRetryCoordinator(input.repository).executeAndPush({
    command,
    schedulerId: input.schedulerId
  })
  return true
}
