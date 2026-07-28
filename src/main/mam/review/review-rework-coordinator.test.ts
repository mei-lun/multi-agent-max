import { describe, expect, it } from 'vitest'
import type { ReviewAggregation } from '../../../shared/mam/domain/review'
import type { Task } from '../../../shared/mam/domain/task'
import { ReviewLoopPolicy } from '../workflow/review-loop-policy'
import { ReviewReworkCoordinator } from './review-rework-coordinator'

describe('Review rework coordinator', () => {
  it('creates a new bounded Attempt with immutable previous-Attempt lineage', () => {
    const policy = new ReviewLoopPolicy()
    const loop = policy.markInReview(policy.create('review.node', 'attempt.1', 3), 'attempt.1')
    const result = new ReviewReworkCoordinator(policy).apply({
      loop,
      aggregation: aggregation('attempt.1', 'changes_requested'),
      task: reviewedTask(),
      nextAttempt: nextAttempt('attempt.2')
    })

    expect(result.loop).toMatchObject({
      activeAttemptId: 'attempt.2',
      attemptNumber: 2,
      status: 'developing'
    })
    expect(result.attempt).toMatchObject({
      id: 'attempt.2',
      number: 2,
      previousAttemptId: 'attempt.1',
      status: 'created'
    })
    expect(result.task).toMatchObject({
      status: 'running',
      attemptIds: ['attempt.1', 'attempt.2']
    })
  })

  it('blocks at the revision limit and never creates another Attempt', () => {
    const policy = new ReviewLoopPolicy()
    const loop = policy.markInReview(policy.create('review.node', 'attempt.1', 1), 'attempt.1')
    const result = new ReviewReworkCoordinator(policy).apply({
      loop,
      aggregation: aggregation('attempt.1', 'changes_requested'),
      task: reviewedTask()
    })
    expect(result).toMatchObject({ loop: { status: 'blocked', attemptNumber: 1 } })
    expect(result.attempt).toBeUndefined()
  })

  it('rejects stale, disputed and lineage-mismatched rework requests', () => {
    const policy = new ReviewLoopPolicy()
    const loop = policy.markInReview(policy.create('review.node', 'attempt.1', 3), 'attempt.1')
    const coordinator = new ReviewReworkCoordinator(policy)
    expect(() =>
      coordinator.apply({
        loop,
        aggregation: aggregation('attempt.old', 'changes_requested'),
        task: reviewedTask(),
        nextAttempt: nextAttempt('attempt.2')
      })
    ).toThrow(expect.objectContaining({ code: 'stale_review_attempt' }))
    expect(() =>
      coordinator.apply({
        loop,
        aggregation: {
          ...aggregation('attempt.1', 'blocked'),
          classification: 'blocking_disagreement',
          requiresHumanDecision: true
        },
        task: reviewedTask()
      })
    ).toThrow(expect.objectContaining({ code: 'human_review_decision_required' }))
    expect(() =>
      coordinator.apply({
        loop,
        aggregation: aggregation('attempt.1', 'changes_requested'),
        task: { ...reviewedTask(), attemptIds: ['attempt.other'] },
        nextAttempt: nextAttempt('attempt.2')
      })
    ).toThrow(expect.objectContaining({ code: 'rework_lineage_mismatch' }))
  })
})

function aggregation(
  attemptId: string,
  proposedStatus: ReviewAggregation['proposedStatus']
): ReviewAggregation {
  return {
    schemaVersion: '1.0.0',
    id: `aggregation.${attemptId}`,
    workflowRunId: 'run.review',
    reviewNodeId: 'review.node',
    attemptId,
    subject: {
      taskId: 'task.implementation',
      attemptId,
      resultHash: 'a'.repeat(64),
      artifactHashes: ['b'.repeat(64)],
      submittedCommit: 'abcdef1'
    },
    classification: 'consensus',
    sourceDecisionIds: ['review.decision.a'],
    findings: [],
    proposedStatus,
    requiresHumanDecision: false,
    createdAt: '2026-07-28T15:00:00Z'
  }
}

function reviewedTask(): Task {
  return {
    schemaVersion: '1.0.0',
    id: 'task.implementation',
    workflowRunId: 'run.review',
    nodeRunId: 'node-run.implementation',
    title: 'Implementation',
    specification: 'Implement the feature.',
    dependencies: [],
    inputArtifacts: [],
    outputContracts: [
      {
        schemaVersion: '1.0.0',
        artifactType: 'artifact.diff',
        format: 'diff',
        required: true,
        maxBytes: 1_000_000
      }
    ],
    recommendedRoleProfileIds: ['role.developer'],
    allowedRoleProfileIds: ['role.developer'],
    assignment: {
      taskId: 'task.implementation',
      roleProfileId: 'role.developer',
      roleProfileVersion: 1,
      assignedByUserId: 'user.owner',
      assignmentCommandId: 'command.assign.implementation',
      assignedAt: '2026-07-28T14:00:00Z'
    },
    executionNotices: [],
    attemptIds: ['attempt.1'],
    selectedAttemptId: 'attempt.1',
    status: 'changes_requested'
  }
}

function nextAttempt(attemptId: string) {
  return {
    attemptId,
    executorInstanceId: 'executor.developer',
    effectiveConfigSnapshotId: `effective.${attemptId}`,
    effectiveConfigHash: 'c'.repeat(64),
    announcedAt: '2026-07-28T15:05:00Z',
    revision: 'revision.2'
  }
}
