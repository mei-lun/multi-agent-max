import { describe, expect, it } from 'vitest'
import type { ReviewAggregation } from '../../../shared/mam/domain/review'
import { SchedulerKernel } from '../scheduler/kernel'
import { applyEvent } from '../state-store/git-event-application'
import { emptyWorkflowRunProjection } from '../state-store/git-state-projection'
import {
  resolvedReviewStatus,
  reviewDisagreementGateId,
  reviewDisagreementResolution
} from './review-disagreement-resolution'

const aggregation: ReviewAggregation = {
  schemaVersion: '1.0.0',
  id: 'aggregation.review.attempt-1',
  workflowRunId: 'run.review',
  reviewNodeId: 'review',
  attemptId: 'attempt-1',
  subject: {
    taskId: 'task-1',
    attemptId: 'attempt-1',
    resultHash: 'a'.repeat(64),
    artifactHashes: []
  },
  classification: 'blocking_disagreement',
  sourceDecisionIds: ['review-1', 'review-2'],
  findings: [],
  proposedStatus: 'blocked',
  requiresHumanDecision: true,
  createdAt: '2026-07-28T20:00:00Z'
}

describe('Review disagreement resolution projection', () => {
  it('accepts a user decision through the Scheduler gate and reconstructs its lineage', () => {
    const gateId = reviewDisagreementGateId(aggregation.id)
    const batch = new SchedulerKernel().execute(
      {
        schemaVersion: '1.0.0',
        commandId: 'command.resolve-review',
        issuedAt: '2026-07-28T20:01:00Z',
        workflowRunId: aggregation.workflowRunId,
        actor: { kind: 'user', userId: 'user.owner' },
        type: 'resolve_approval_gate',
        gateId,
        option: 'approved'
      },
      {
        schedulerId: 'scheduler.1',
        approvalGates: new Map([
          [
            gateId,
            {
              status: 'pending' as const,
              options: new Set(['approved', 'changes_requested', 'blocked'])
            }
          ]
        ]),
        validArtifactHashes: new Set(),
        processedCommandIds: new Set(),
        mergeQueueEntries: new Map()
      }
    )
    const projection = applyEvent(
      {
        ...emptyWorkflowRunProjection(aggregation.workflowRunId),
        tasks: {
          [aggregation.subject.taskId]: {
            status: 'in_review',
            roleProfileId: 'role.builder',
            roleProfileVersion: 1,
            assignedByUserId: 'user.owner',
            activeAttemptIds: [],
            knownAttemptIds: [aggregation.subject.attemptId],
            reviewIds: [],
            executionWarnings: [],
            lastEventId: 'event.aggregation'
          }
        },
        reviewAggregations: { [aggregation.id]: aggregation }
      },
      batch.events[0]!
    )
    expect(resolvedReviewStatus(aggregation, projection)).toBe('approved')
    expect(projection.tasks[aggregation.subject.taskId]?.status).toBe('approved')
    expect(reviewDisagreementResolution(aggregation, projection)).toMatchObject({
      aggregationId: aggregation.id,
      sourceDecisionIds: aggregation.sourceDecisionIds,
      commandId: 'command.resolve-review',
      userId: 'user.owner',
      selectedOption: 'approved',
      resolvedAt: '2026-07-28T20:01:00Z'
    })
  })
})
