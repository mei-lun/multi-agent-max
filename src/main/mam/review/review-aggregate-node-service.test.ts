import { describe, expect, it } from 'vitest'
import type { ReviewAggregation } from '../../../shared/mam/domain/review'
import { aggregateReviewGates } from './review-aggregate-node-service'

describe('aggregateReviewGates', () => {
  it('is stable across Review Gate completion order', () => {
    const left = aggregation('review.security', 'approved')
    const right = aggregation('review.quality', 'approved')
    expect(aggregateReviewGates(input([right, left]))).toEqual(
      aggregateReviewGates(input([left, right]))
    )
  })

  it('requires a human decision for mixed statuses', () => {
    expect(
      aggregateReviewGates(
        input([aggregation('review.a', 'approved'), aggregation('review.b', 'changes_requested')])
      )
    ).toMatchObject({ classification: 'blocking_disagreement', requiresHumanDecision: true })
  })

  it('blocks only after the configured aggregate revision limit', () => {
    const aggregations = [
      aggregation('review.a', 'changes_requested'),
      aggregation('review.b', 'changes_requested')
    ]
    expect(
      aggregateReviewGates({ ...input(aggregations), formalRevisionNumber: 1 }).proposedStatus
    ).toBe('changes_requested')
    expect(
      aggregateReviewGates({ ...input(aggregations), formalRevisionNumber: 2 }).proposedStatus
    ).toBe('blocked')
  })
})

function input(aggregations: ReviewAggregation[]) {
  return {
    aggregateNodeId: 'review.aggregate',
    aggregations,
    totalQuorum: 2,
    formalRevisionNumber: 0,
    maxRevisionAttempts: 2,
    createdAt: '2026-09-17T12:00:00Z'
  }
}

function aggregation(
  reviewNodeId: string,
  proposedStatus: 'approved' | 'changes_requested'
): ReviewAggregation {
  return {
    schemaVersion: '1.0.0',
    id: `aggregation.${reviewNodeId}`,
    workflowRunId: 'run.1',
    reviewNodeId,
    attemptId: 'attempt.delivery',
    subject: {
      taskId: 'task.1',
      attemptId: 'attempt.delivery',
      resultHash: 'a'.repeat(64),
      artifactHashes: []
    },
    classification: 'consensus',
    sourceDecisionIds: [`decision.${reviewNodeId}`],
    findings: [],
    proposedStatus,
    requiresHumanDecision: false,
    createdAt: '2026-09-17T11:00:00Z'
  }
}
