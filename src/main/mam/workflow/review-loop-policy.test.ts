import { describe, expect, it } from 'vitest'
import type { ReviewDecision } from '../../../shared/mam/domain/review'
import { ReviewLoopPolicy } from './review-loop-policy'

function decision(attemptId: string, status: ReviewDecision['status']): ReviewDecision {
  return {
    schemaVersion: '1.0.0',
    id: `decision.${attemptId}.${status}`,
    workflowRunId: 'run.1',
    reviewNodeId: 'review.1',
    attemptId,
    subject: {
      taskId: 'task.implementation',
      attemptId,
      resultHash: 'a'.repeat(64),
      artifactHashes: ['b'.repeat(64)]
    },
    reviewerTaskId: 'task.review.1',
    reviewerAttemptId: `attempt.reviewer.${attemptId}`,
    reviewerRoleInstanceId: 'reviewer.1',
    status,
    findings:
      status === 'changes_requested'
        ? [
            {
              schemaVersion: '1.0.0',
              id: `finding.${attemptId}`,
              attemptId,
              severity: 'high',
              category: 'correctness',
              summary: 'The implementation needs a correction.',
              evidence: []
            }
          ]
        : [],
    summary: status === 'approved' ? 'Approved.' : 'Revision required.',
    createdAt: '2026-07-22T20:00:00Z'
  }
}

describe('ReviewLoopPolicy', () => {
  it('runs development, review, revision, and approval with immutable attempts', () => {
    const policy = new ReviewLoopPolicy()
    const firstReview = policy.markInReview(policy.create('review.1', 'attempt.1', 3), 'attempt.1')
    const requested = policy.applyDecision(firstReview, decision('attempt.1', 'changes_requested'))
    const revision = policy.beginRevision(requested, 'attempt.2')
    const secondReview = policy.markInReview(revision, 'attempt.2')

    expect(() =>
      policy.applyDecision(secondReview, decision('attempt.1', 'approved'))
    ).toThrowError(expect.objectContaining({ code: 'stale_review_attempt' }))

    const approved = policy.applyDecision(secondReview, decision('attempt.2', 'approved'))
    expect(approved).toMatchObject({ status: 'approved', attemptNumber: 2 })
    expect(approved.decisions.map((item) => item.attemptId)).toEqual(['attempt.1', 'attempt.2'])
    expect(firstReview.status).toBe('in_review')
  })

  it('blocks the loop when the configured revision limit is reached', () => {
    const policy = new ReviewLoopPolicy()
    let state = policy.markInReview(policy.create('review.1', 'attempt.1', 2), 'attempt.1')
    state = policy.applyDecision(state, decision('attempt.1', 'changes_requested'))
    state = policy.beginRevision(state, 'attempt.2')
    state = policy.markInReview(state, 'attempt.2')
    state = policy.applyDecision(state, decision('attempt.2', 'changes_requested'))

    expect(state).toMatchObject({ status: 'blocked', attemptNumber: 2 })
  })

  it('rejects unstructured reviewer text', () => {
    const policy = new ReviewLoopPolicy()
    const state = policy.markInReview(policy.create('review.1', 'attempt.1', 2), 'attempt.1')

    expect(() => policy.applyDecision(state, 'LGTM')).toThrowError(
      expect.objectContaining({ code: 'invalid_review_decision' })
    )
  })
})
