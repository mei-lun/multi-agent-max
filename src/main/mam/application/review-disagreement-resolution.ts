import type {
  ReviewAggregation,
  ReviewDecision,
  ReviewDisagreementResolution
} from '../../../shared/mam/domain/review'
import type { WorkflowRunProjection } from '../state-store/git-state-projection'

export type ResolvedReviewStatus = ReviewDecision['status']

export function reviewDisagreementGateId(aggregationId: string): string {
  return `gate.${aggregationId}`
}

export function resolvedReviewStatus(
  aggregation: ReviewAggregation,
  projection: WorkflowRunProjection
): ResolvedReviewStatus | undefined {
  if (!aggregation.requiresHumanDecision) return aggregation.proposedStatus
  const option = projection.resolvedApprovalGates[reviewDisagreementGateId(aggregation.id)]?.option
  return option === 'approved' || option === 'changes_requested' || option === 'blocked'
    ? option
    : undefined
}

export function reviewDisagreementResolution(
  aggregation: ReviewAggregation,
  projection: WorkflowRunProjection
): ReviewDisagreementResolution | undefined {
  const gate = projection.resolvedApprovalGates[reviewDisagreementGateId(aggregation.id)]
  if (!gate?.commandId || !gate.resolvedAt) return undefined
  return {
    schemaVersion: '1.0.0',
    aggregationId: aggregation.id,
    sourceDecisionIds: [...aggregation.sourceDecisionIds],
    commandId: gate.commandId,
    userId: gate.userId,
    selectedOption: gate.option,
    resolvedAt: gate.resolvedAt
  }
}
