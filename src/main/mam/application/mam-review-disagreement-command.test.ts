import { describe, expect, it, vi } from 'vitest'
import type { ReviewAggregation } from '../../../shared/mam/domain/review'
import { resolveReviewDisagreementAndPublishMerge } from './mam-review-disagreement-command'

const calls = vi.hoisted(() => ({
  executeAndPush: vi.fn(),
  publishMerge: vi.fn(),
  advancePanel: vi.fn(),
  advanceDeterministic: vi.fn()
}))

vi.mock('../state-store/git-command-retry-coordinator', () => ({
  GitCommandRetryCoordinator: class {
    executeAndPush = calls.executeAndPush
  }
}))
vi.mock('./merge-readiness-publisher', () => ({
  publishMergeReadinessIfEligible: calls.publishMerge
}))
vi.mock('./review-panel-advancement', () => ({ advanceReadyReviewPanel: calls.advancePanel }))
vi.mock('./deterministic-node-advancement', () => ({
  advanceDeterministicNodes: calls.advanceDeterministic
}))

describe('Review disagreement command', () => {
  it('continues from an approved Review gate to the next Review panel', () => {
    const aggregation = disagreementAggregation()
    const repository = {
      rebuild: () => ({
        reviewAggregations: { [aggregation.id]: aggregation },
        tasks: { [aggregation.subject.taskId]: { knownAttemptIds: [aggregation.attemptId] } },
        attempts: {
          [aggregation.attemptId]: {
            taskId: aggregation.subject.taskId,
            status: 'submitted',
            lastEventId: 'event.delivery'
          }
        }
      }),
      loadRunBundle: () => ({
        definition: {
          nodes: [
            {
              id: aggregation.reviewNodeId,
              type: 'review_gate',
              maxRevisionAttempts: 2
            }
          ]
        }
      })
    }

    resolveReviewDisagreementAndPublishMerge({
      request: {
        workflowRunId: aggregation.workflowRunId,
        aggregationId: aggregation.id,
        selectedStatus: 'approved'
      },
      repository: repository as never,
      schedulerId: 'scheduler.desktop',
      userId: 'user.owner',
      nextCommandId: sequentialCommandIds(),
      now: () => '2026-09-15T10:00:00Z'
    })

    expect(calls.advancePanel).toHaveBeenCalledWith({
      repository,
      workflowRunId: aggregation.workflowRunId,
      sourceTaskId: aggregation.subject.taskId,
      sourceNodeId: aggregation.reviewNodeId,
      schedulerId: 'scheduler.desktop',
      commandId: 'command.3',
      issuedAt: '2026-09-15T10:00:00Z'
    })
  })
})

function disagreementAggregation(): ReviewAggregation {
  return {
    schemaVersion: '1.0.0',
    id: 'aggregation.review-first.attempt-source',
    workflowRunId: 'run.review-chain',
    reviewNodeId: 'review-first',
    attemptId: 'attempt-source',
    subject: {
      taskId: 'task-source',
      attemptId: 'attempt-source',
      resultHash: 'a'.repeat(64),
      artifactHashes: []
    },
    classification: 'blocking_disagreement',
    sourceDecisionIds: ['review.one', 'review.two'],
    findings: [],
    proposedStatus: 'blocked',
    requiresHumanDecision: true,
    createdAt: '2026-09-15T09:00:00Z'
  }
}

function sequentialCommandIds(): () => string {
  let count = 0
  return () => `command.${String((count += 1))}`
}
