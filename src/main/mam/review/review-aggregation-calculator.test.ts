import { describe, expect, it } from 'vitest'
import type { ReviewDecision } from '../../../shared/mam/domain/review'
import { calculateReviewAggregation } from './review-aggregation-calculator'

describe('calculateReviewAggregation', () => {
  it('is independent of Review completion order', () => {
    const left = decision('left', 'changes_requested', 'Missing keyboard coverage.')
    const right = decision('right', 'changes_requested', 'Missing boundary coverage.')

    const first = calculateReviewAggregation({
      decisions: [right, left],
      createdAt: '2026-09-17T08:00:00Z',
      formalRevisionNumber: 0,
      maxRevisionAttempts: 2
    })
    const second = calculateReviewAggregation({
      decisions: [left, right],
      createdAt: '2026-09-17T08:00:00Z',
      formalRevisionNumber: 0,
      maxRevisionAttempts: 2
    })

    expect(first).toEqual(second)
    expect(first.sourceDecisionIds).toEqual(['decision.left', 'decision.right'])
    expect(first.findings.map((finding) => finding.id)).toEqual(['finding.right', 'finding.left'])
  })

  it('counts only revisions after the initial delivery', () => {
    const available = calculateReviewAggregation({
      decisions: [decision('only', 'changes_requested', 'Clarify the input boundary.')],
      createdAt: '2026-09-17T08:00:00Z',
      formalRevisionNumber: 1,
      maxRevisionAttempts: 2
    })
    const exhausted = calculateReviewAggregation({
      decisions: [decision('only', 'changes_requested', 'Clarify the input boundary.')],
      createdAt: '2026-09-17T08:00:00Z',
      formalRevisionNumber: 2,
      maxRevisionAttempts: 2
    })

    expect(available.proposedStatus).toBe('changes_requested')
    expect(exhausted.proposedStatus).toBe('blocked')
  })
})

function decision(
  suffix: string,
  status: 'approved' | 'changes_requested',
  findingSummary?: string
): ReviewDecision {
  return {
    schemaVersion: '1.0.0',
    id: `decision.${suffix}`,
    workflowRunId: 'run.1',
    reviewNodeId: 'review.1',
    attemptId: 'attempt.subject',
    subject: {
      taskId: 'task.subject',
      attemptId: 'attempt.subject',
      resultHash: 'a'.repeat(64),
      artifactHashes: ['b'.repeat(64)],
      submittedCommit: 'abcdef1'
    },
    reviewerTaskId: `review-task.${suffix}`,
    reviewerAttemptId: `review-attempt.${suffix}`,
    reviewerRoleInstanceId: `role-instance.${suffix}`,
    status,
    findings: findingSummary
      ? [
          {
            schemaVersion: '1.0.0',
            id: `finding.${suffix}`,
            attemptId: 'attempt.subject',
            severity: 'high',
            category: 'correctness',
            summary: findingSummary,
            evidence: []
          }
        ]
      : [],
    summary: status === 'approved' ? 'Approved.' : 'Changes requested.',
    createdAt: '2026-09-17T07:59:00Z'
  }
}
