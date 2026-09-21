import { ReviewAggregationSchema, type ReviewAggregation } from '../../../shared/mam/domain/review'
import { boundedReviewStatus } from './review-revision-limit'

export function aggregateReviewGates(input: {
  aggregateNodeId: string
  aggregations: readonly ReviewAggregation[]
  totalQuorum: number
  formalRevisionNumber: number
  maxRevisionAttempts: number
  createdAt: string
}): ReviewAggregation {
  if (input.aggregations.length < input.totalQuorum)
    throw new Error('review_aggregate_quorum_unmet')
  const members = [...input.aggregations].sort(
    (left, right) =>
      left.reviewNodeId.localeCompare(right.reviewNodeId) || left.id.localeCompare(right.id)
  )
  const first = members[0]!
  if (members.some((member) => JSON.stringify(member.subject) !== JSON.stringify(first.subject))) {
    throw new Error('review_aggregate_subject_mismatch')
  }
  const statuses = new Set(members.map((member) => member.proposedStatus))
  const blocking = statuses.size > 1
  const findings = new Map(
    members.flatMap((member) => member.findings).map((finding) => [finding.id, finding] as const)
  )
  return ReviewAggregationSchema.parse({
    schemaVersion: '1.0.0',
    id: `aggregation.${input.aggregateNodeId}.${first.attemptId}`,
    workflowRunId: first.workflowRunId,
    reviewNodeId: input.aggregateNodeId,
    attemptId: first.attemptId,
    subject: first.subject,
    classification: blocking ? 'blocking_disagreement' : 'consensus',
    sourceDecisionIds: members.flatMap((member) => member.sourceDecisionIds),
    findings: [...findings.values()].sort((left, right) => left.id.localeCompare(right.id)),
    proposedStatus: boundedReviewStatus({
      status: blocking ? 'blocked' : first.proposedStatus,
      revisionCount: input.formalRevisionNumber,
      maxRevisionAttempts: input.maxRevisionAttempts
    }),
    requiresHumanDecision: blocking,
    createdAt: input.createdAt
  })
}
