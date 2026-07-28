import { describe, expect, it } from 'vitest'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import { SchedulerKernel, type KernelEventBatch } from '../scheduler/kernel'
import { ReviewAggregationPolicy } from './review-aggregation-policy'

describe('ReviewAggregationPolicy', () => {
  it('classifies consensus and mergeable finding differences without a user gate', () => {
    const policy = new ReviewAggregationPolicy(() => '2026-07-22T20:00:00Z')
    const consensus = policy.aggregate([
      decision('A', 'approved'),
      decision('B', 'approved'),
      decision('C', 'approved')
    ])
    expect(consensus).toMatchObject({
      status: 'aggregated',
      aggregation: { classification: 'consensus', proposedStatus: 'approved' }
    })

    const mergeable = policy.aggregate([
      decision('A', 'changes_requested', 'Missing empty-cart check.'),
      decision('B', 'changes_requested', 'Missing audit log.'),
      decision('C', 'changes_requested', 'Missing empty-cart check.')
    ])
    expect(mergeable).toMatchObject({
      status: 'aggregated',
      aggregation: {
        classification: 'mergeable_disagreement',
        proposedStatus: 'changes_requested'
      }
    })
    expect(mergeable.aggregation.findings).toHaveLength(2)
  })

  it('pauses a conflicting workflow until a real user command resolves the disagreement', () => {
    const policy = new ReviewAggregationPolicy(() => '2026-07-22T20:00:00Z')
    const state = policy.aggregate([
      decision('A', 'approved'),
      decision('B', 'changes_requested', 'Missing audit log.'),
      decision('C', 'approved')
    ])
    expect(state).toMatchObject({
      status: 'awaiting_human_decision',
      aggregation: { classification: 'blocking_disagreement', requiresHumanDecision: true }
    })

    const kernel = new SchedulerKernel()
    expect(() => kernel.execute(schedulerCommand(state.gateId!), context(state.gateId!))).toThrow(
      expect.objectContaining({ code: 'user_authority_required' })
    )

    const batch = kernel.execute(userCommand(state.gateId!), context(state.gateId!))
    expect(() =>
      policy.applyKernelBatch(state, { events: batch.events } as KernelEventBatch)
    ).toThrow(expect.objectContaining({ code: 'scheduler_authority_required' }))

    const resolved = policy.applyKernelBatch(state, batch)
    expect(resolved).toMatchObject({
      status: 'resolved',
      resolution: {
        sourceDecisionIds: ['decision.A', 'decision.B', 'decision.C'],
        commandId: 'command.user-decision.1',
        userId: 'user.1',
        selectedOption: 'request_changes',
        resolvedAt: '2026-07-22T20:05:00Z'
      }
    })
  })
})

function decision(
  suffix: string,
  status: 'approved' | 'changes_requested',
  findingSummary?: string
) {
  return {
    schemaVersion: '1.0.0',
    id: `decision.${suffix}`,
    workflowRunId: 'run.1',
    reviewNodeId: 'review.1',
    attemptId: 'attempt.review.1',
    subject: {
      taskId: 'task.implementation',
      attemptId: 'attempt.review.1',
      resultHash: 'a'.repeat(64),
      artifactHashes: ['b'.repeat(64)],
      submittedCommit: 'abcdef1'
    },
    reviewerTaskId: `task.review.${suffix}`,
    reviewerAttemptId: `attempt.reviewer.${suffix}`,
    reviewerRoleInstanceId: `reviewer.${suffix}`,
    status,
    findings: findingSummary
      ? [
          {
            schemaVersion: '1.0.0',
            id: `finding.${suffix}`,
            attemptId: 'attempt.review.1',
            severity: 'high',
            category: 'correctness',
            summary: findingSummary,
            evidence: []
          }
        ]
      : [],
    summary: status === 'approved' ? 'Approved.' : 'Changes requested.',
    createdAt: '2026-07-22T20:00:00Z'
  }
}

function userCommand(gateId: string): SchedulerCommand {
  return {
    schemaVersion: '1.0.0',
    type: 'resolve_approval_gate',
    commandId: 'command.user-decision.1',
    issuedAt: '2026-07-22T20:05:00Z',
    workflowRunId: 'run.1',
    actor: { kind: 'user', userId: 'user.1' },
    gateId,
    option: 'request_changes'
  }
}

function schedulerCommand(gateId: string): SchedulerCommand {
  return {
    ...userCommand(gateId),
    commandId: 'command.scheduler-forgery.1',
    actor: { kind: 'scheduler', schedulerId: 'scheduler.1' }
  }
}

function context(gateId: string) {
  return {
    schedulerId: 'scheduler.1',
    approvalGates: new Map([
      [
        gateId,
        {
          status: 'pending' as const,
          options: new Set(['accept_approved', 'request_changes', 'block'])
        }
      ]
    ]),
    validArtifactHashes: new Set<string>(),
    processedCommandIds: new Set<string>(),
    mergeQueueEntries: new Map()
  }
}
