import { describe, expect, it } from 'vitest'
import type { ReviewAggregation } from '../../../shared/mam/domain/review'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import { aggregateReviewGates } from '../review/review-aggregate-node-service'
import type { SchedulerKernelContext } from './scheduler-kernel-context'
import { assertReviewAggregateAuthority } from './review-aggregate-command-authority'

describe('assertReviewAggregateAuthority', () => {
  it('fences stale subjects and requires the canonical quorum member set', () => {
    const a = member('review.a')
    const b = member('review.b')
    const c = member('review.c')
    const valid = command([a, b])
    expect(() => assertReviewAggregateAuthority(valid, context([a, b, c]))).not.toThrow()
    expect(() => assertReviewAggregateAuthority(command([a, c]), context([a, b, c]))).toThrow(
      expect.objectContaining({ code: 'review_aggregate_member_mismatch' })
    )
    expect(() =>
      assertReviewAggregateAuthority(valid, {
        ...context([a, b, c]),
        taskCurrentDeliveryIds: new Map([['task.1', 'attempt.new']])
      })
    ).toThrow(expect.objectContaining({ code: 'review_aggregate_stale_subject' }))
  })
})

function command(
  members: ReviewAggregation[]
): Extract<SchedulerCommand, { type: 'record_review_aggregate' }> {
  const aggregation = aggregateReviewGates({
    aggregateNodeId: 'review.aggregate',
    aggregations: members,
    totalQuorum: 2,
    formalRevisionNumber: 0,
    maxRevisionAttempts: 2,
    createdAt: '2026-09-17T12:00:00Z'
  })
  return {
    schemaVersion: '1.0.0',
    commandId: 'command.aggregate',
    issuedAt: aggregation.createdAt,
    workflowRunId: 'run.1',
    taskId: 'task.1',
    actor: { kind: 'scheduler', schedulerId: 'scheduler.desktop' },
    type: 'record_review_aggregate',
    memberAggregationIds: members.map((member) => member.id),
    aggregation
  }
}

function context(members: ReviewAggregation[]): SchedulerKernelContext {
  return {
    schedulerId: 'scheduler.desktop',
    validArtifactHashes: new Set(),
    processedCommandIds: new Set(),
    mergeQueueEntries: new Map(),
    reviewAggregations: new Map(members.map((member) => [member.id, member])),
    taskCurrentDeliveryIds: new Map([['task.1', 'attempt.delivery']]),
    runBundle: {
      definition: {
        nodes: [
          {
            id: 'review.aggregate',
            type: 'review_aggregate',
            producerNodeId: 'node.producer',
            reviewNodeIds: ['review.a', 'review.b', 'review.c'],
            totalQuorum: 2,
            maxRevisionAttempts: 2,
            revisionTargetNodeId: 'node.producer',
            disagreementPolicy: 'human_decision'
          }
        ]
      },
      taskCatalog: [{ id: 'task.1', nodeId: 'node.producer' }]
    }
  } as unknown as SchedulerKernelContext
}

function member(reviewNodeId: string): ReviewAggregation {
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
    proposedStatus: 'approved',
    requiresHumanDecision: false,
    createdAt: '2026-09-17T11:00:00Z'
  }
}
