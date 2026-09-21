import { describe, expect, it, vi } from 'vitest'
import type { ReviewDecision, ReviewSubject } from '../../../shared/mam/domain/review'
import { publishReviewAggregationIfReady } from './review-aggregation-publisher'

const calls = vi.hoisted(() => ({ executeAndPush: vi.fn() }))

vi.mock('../state-store/git-command-retry-coordinator', () => ({
  GitCommandRetryCoordinator: class {
    executeAndPush = calls.executeAndPush
  }
}))

describe('publishReviewAggregationIfReady', () => {
  it('ignores timeout-only Attempt lineage when applying the revision limit', () => {
    const subject = reviewSubject()
    const review = reviewDecision(subject)
    const repository = {
      loadRunBundle: () => ({
        definition: {
          nodes: [
            {
              id: review.reviewNodeId,
              type: 'review_gate',
              minimumDecisions: 1,
              maxRevisionAttempts: 2
            }
          ],
          edges: []
        }
      }),
      rebuild: () => ({
        reviewAggregations: {},
        reviews: { [review.id]: review },
        reviewValidity: { [review.id]: { status: 'valid' } },
        attempts: {
          'attempt.timeout-1': attempt('needs_reconciliation'),
          'attempt.timeout-2': attempt('blocked', 'attempt.timeout-1'),
          [subject.attemptId]: attempt('submitted', 'attempt.timeout-2')
        }
      })
    }

    expect(
      publishReviewAggregationIfReady({
        repository: repository as never,
        workflowRunId: review.workflowRunId,
        reviewNodeId: review.reviewNodeId,
        subject,
        schedulerId: 'scheduler.desktop',
        commandId: 'command.aggregate',
        issuedAt: '2026-09-17T08:00:00Z'
      })
    ).toBe(true)

    expect(calls.executeAndPush).toHaveBeenCalledWith(
      expect.objectContaining({
        command: expect.objectContaining({
          aggregation: expect.objectContaining({ proposedStatus: 'changes_requested' })
        })
      })
    )
  })
})

function reviewSubject(): ReviewSubject {
  return {
    taskId: 'task.subject',
    attemptId: 'attempt.delivered',
    resultHash: 'a'.repeat(64),
    artifactHashes: ['b'.repeat(64)]
  }
}

function reviewDecision(subject: ReviewSubject): ReviewDecision {
  return {
    schemaVersion: '1.0.0',
    id: 'review.decision',
    workflowRunId: 'run.1',
    reviewNodeId: 'review.node',
    attemptId: subject.attemptId,
    subject,
    reviewerTaskId: 'review-task.1',
    reviewerAttemptId: 'review-attempt.1',
    reviewerRoleInstanceId: 'role-instance.reviewer',
    status: 'changes_requested',
    findings: [
      {
        schemaVersion: '1.0.0',
        id: 'finding.1',
        attemptId: subject.attemptId,
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

function attempt(status: string, previousAttemptId?: string) {
  return {
    taskId: 'task.subject',
    status,
    ...(previousAttemptId ? { previousAttemptId } : {}),
    lastEventId: `event.${status}`
  }
}
