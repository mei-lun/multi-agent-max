import { describe, expect, it } from 'vitest'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import type { SchedulerTaskContext } from './scheduler-kernel-context'
import { calculateReviewAggregation } from '../review/review-aggregation-calculator'
import {
  assertReviewAggregationAuthority,
  assertReviewDecisionBinding
} from './review-command-authority'
import type { ReviewDecision } from '../../../shared/mam/domain/review'

describe('assertReviewAggregationAuthority', () => {
  it('uses the same revision-bounded canonical aggregation as the publisher', () => {
    const decision = reviewDecision()
    const aggregation = calculateReviewAggregation({
      decisions: [decision],
      createdAt: '2026-09-17T08:00:00Z',
      formalRevisionNumber: 0,
      maxRevisionAttempts: 2
    })
    const command = aggregationCommand(aggregation)

    expect(() =>
      assertReviewAggregationAuthority(command, taskContext(decision), 'scheduler.desktop')
    ).not.toThrow()
    expect(() =>
      assertReviewAggregationAuthority(
        { ...command, aggregation: { ...aggregation, proposedStatus: 'blocked' } },
        taskContext(decision),
        'scheduler.desktop'
      )
    ).toThrow(expect.objectContaining({ code: 'review_aggregation_mismatch' }))
  })
})

describe('assertReviewDecisionBinding', () => {
  it('requires an atomic decision for Reviewer Delivery and rejects another gate', () => {
    const decision = reviewDecision()
    const binding = {
      review: decision,
      workflowRunId: decision.workflowRunId,
      reviewerTaskId: decision.reviewerTaskId,
      reviewerAttemptId: decision.reviewerAttemptId,
      reviewerRoleInstanceId: decision.reviewerRoleInstanceId,
      reviewTarget: decision.subject,
      reviewNodeId: decision.reviewNodeId
    }
    expect(() => assertReviewDecisionBinding(binding)).not.toThrow()
    expect(() => assertReviewDecisionBinding({ ...binding, review: undefined })).toThrow(
      expect.objectContaining({ code: 'review_required' })
    )
    expect(() =>
      assertReviewDecisionBinding({
        ...binding,
        review: { ...decision, reviewNodeId: 'review.other' }
      })
    ).toThrow(expect.objectContaining({ code: 'review_binding_mismatch' }))
  })
})

function aggregationCommand(
  aggregation: ReturnType<typeof calculateReviewAggregation>
): Extract<SchedulerCommand, { type: 'record_review_aggregation' }> {
  return {
    schemaVersion: '1.0.0',
    commandId: 'command.aggregate',
    issuedAt: aggregation.createdAt,
    workflowRunId: aggregation.workflowRunId,
    taskId: aggregation.subject.taskId,
    actor: { kind: 'scheduler', schedulerId: 'scheduler.desktop' },
    type: 'record_review_aggregation',
    aggregation
  }
}

function taskContext(decision: ReviewDecision): SchedulerTaskContext {
  return {
    workflowRunId: decision.workflowRunId,
    taskId: decision.subject.taskId,
    status: 'in_review',
    activeAttemptIds: new Set(),
    knownAttemptIds: new Set([decision.attemptId]),
    submittedAttemptIds: new Set([decision.attemptId]),
    attemptBindings: new Map(),
    allowedRoleProfileIds: new Set(),
    roleCatalogVersions: new Map(),
    reviewDecisions: new Map([[decision.id, decision]]),
    minimumReviewDecisions: 1,
    formalRevisionNumber: 0,
    maxRevisionAttempts: 2
  }
}

function reviewDecision(): ReviewDecision {
  return {
    schemaVersion: '1.0.0',
    id: 'review.decision',
    workflowRunId: 'run.1',
    reviewNodeId: 'review.node',
    attemptId: 'attempt.delivered',
    subject: {
      taskId: 'task.subject',
      attemptId: 'attempt.delivered',
      resultHash: 'a'.repeat(64),
      artifactHashes: []
    },
    reviewerTaskId: 'review-task.1',
    reviewerAttemptId: 'review-attempt.1',
    reviewerRoleInstanceId: 'role-instance.reviewer',
    status: 'changes_requested',
    findings: [
      {
        schemaVersion: '1.0.0',
        id: 'finding.1',
        attemptId: 'attempt.delivered',
        severity: 'medium',
        category: 'correctness',
        summary: 'Clarify the negative input boundary.',
        evidence: []
      }
    ],
    summary: 'Changes requested.',
    createdAt: '2026-09-17T07:59:00Z'
  }
}
