import { describe, expect, it } from 'vitest'
import type {
  ReviewAggregation,
  ReviewDecision,
  ReviewSubject
} from '../../../shared/mam/domain/review'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import { SchedulerKernel } from '../scheduler/kernel'
import { applyEvent } from '../state-store/git-event-application'
import {
  emptyWorkflowRunProjection,
  schedulerContextFromProjection,
  type WorkflowRunProjection
} from '../state-store/git-event-projection'
import { ReviewAggregationPolicy } from './review-aggregation-policy'

const subject: ReviewSubject = {
  taskId: 'task.implementation',
  attemptId: 'attempt.implementation.2',
  resultHash: 'a'.repeat(64),
  artifactHashes: ['b'.repeat(64)],
  submittedCommit: 'abcdef1'
}

describe('Review Scheduler event flow', () => {
  it('binds a reviewer invocation to the latest immutable target and later invalidates it', () => {
    const kernel = new SchedulerKernel()
    let projection = reviewProjection()
    const context = schedulerContextFromProjection(projection, {
      schedulerId: 'scheduler.1',
      taskId: 'task.review.a',
      taskDefinition: reviewTaskDefinition(subject)
    })
    const batch = kernel.execute(recordReviewCommand(reviewDecision(subject)), context)
    const event = batch.events[0]!
    expect(event).toMatchObject({
      type: 'review_recorded',
      taskId: 'task.review.a',
      attemptId: 'attempt.review.a',
      review: { subject }
    })

    projection = applyEvent(projection, event)
    expect(projection.tasks['task.review.a']?.status).toBe('submitted')
    expect(projection.tasks['task.implementation']).toMatchObject({
      status: 'in_review',
      reviewIds: ['review.decision.a']
    })
    expect(projection.reviewValidity['review.decision.a']).toEqual({ status: 'valid' })

    const aggregation = new ReviewAggregationPolicy(() => '2026-07-28T14:06:00Z').aggregate([
      reviewDecision(subject)
    ]).aggregation
    const aggregationEvent = kernel.execute(
      recordAggregationCommand(aggregation),
      schedulerContextFromProjection(projection, {
        schedulerId: 'scheduler.1',
        taskId: subject.taskId,
        taskDefinition: {
          initialStatus: 'waiting_role_assignment',
          allowedRoleProfileIds: ['role.developer'],
          roleCatalogVersions: new Map([['role.developer', new Set([1])]]),
          minimumReviewDecisions: 1
        }
      })
    ).events[0]!
    projection = applyEvent(projection, aggregationEvent)
    expect(projection.tasks['task.implementation']?.status).toBe('approved')
    expect(projection.reviewAggregations[aggregation.id]).toEqual(aggregation)

    const nextAttempt = kernel.execute(
      announceNextAttemptCommand(),
      schedulerContextFromProjection(projection, {
        schedulerId: 'scheduler.1',
        taskId: 'task.implementation'
      })
    ).events[0]!
    projection = applyEvent(projection, nextAttempt)
    expect(projection.reviewValidity['review.decision.a']).toEqual({
      status: 'invalidated',
      invalidatedByAttemptId: 'attempt.implementation.3'
    })
    expect(projection.attempts['attempt.implementation.3']?.previousAttemptId).toBe(
      'attempt.implementation.2'
    )
    expect(projection.reviews['review.decision.a']?.subject).toEqual(subject)
  })

  it('rejects a Review whose result hash or reviewer Attempt differs from the assignment', () => {
    const projection = reviewProjection()
    const kernel = new SchedulerKernel()
    const context = schedulerContextFromProjection(projection, {
      schedulerId: 'scheduler.1',
      taskId: 'task.review.a',
      taskDefinition: reviewTaskDefinition(subject)
    })
    const changedSubject = { ...subject, resultHash: 'c'.repeat(64) }
    expect(() =>
      kernel.execute(recordReviewCommand(reviewDecision(changedSubject)), context)
    ).toThrow(expect.objectContaining({ code: 'review_binding_mismatch' }))
    expect(() =>
      kernel.execute(
        recordReviewCommand({
          ...reviewDecision(subject),
          reviewerAttemptId: 'attempt.review.foreign'
        }),
        context
      )
    ).toThrow(expect.objectContaining({ code: 'review_binding_mismatch' }))
    expect(() =>
      kernel.execute(
        recordReviewCommand(reviewDecision(subject)),
        schedulerContextFromProjection(projection, {
          schedulerId: 'scheduler.1',
          taskId: 'task.review.a'
        })
      )
    ).toThrow(expect.objectContaining({ code: 'review_target_required' }))
  })
})

function reviewProjection(): WorkflowRunProjection {
  const empty = emptyWorkflowRunProjection('run.review')
  return {
    ...empty,
    tasks: {
      'task.implementation': taskProjection('submitted', 'role.developer', [subject.attemptId]),
      'task.review.a': taskProjection('running', 'role.reviewer', ['attempt.review.a'])
    },
    attempts: {
      [subject.attemptId]: {
        taskId: subject.taskId,
        status: 'submitted',
        roleInstanceId: 'role-instance.developer',
        executorInvocationId: 'invocation.developer',
        effectiveConfigHash: 'd'.repeat(64),
        lastEventId: 'event.result.implementation'
      },
      'attempt.review.a': {
        taskId: 'task.review.a',
        status: 'running',
        roleInstanceId: 'role-instance.review.a',
        executorInvocationId: 'invocation.review.a',
        effectiveConfigHash: 'e'.repeat(64),
        lastEventId: 'event.start.review.a'
      }
    }
  }
}

function taskProjection(
  status: 'submitted' | 'running',
  roleProfileId: string,
  attemptIds: string[]
) {
  return {
    status,
    roleProfileId,
    roleProfileVersion: 1,
    assignedByUserId: 'user.owner',
    activeAttemptIds: status === 'running' ? attemptIds : [],
    knownAttemptIds: attemptIds,
    reviewIds: [],
    executionWarnings: [],
    lastEventId: `event.${status}`
  }
}

function reviewTaskDefinition(reviewTarget: ReviewSubject) {
  return {
    initialStatus: 'waiting_role_assignment' as const,
    allowedRoleProfileIds: ['role.reviewer'],
    roleCatalogVersions: new Map([['role.reviewer', new Set([1])]]),
    reviewTarget
  }
}

function reviewDecision(target: ReviewSubject): ReviewDecision {
  return {
    schemaVersion: '1.0.0',
    id: 'review.decision.a',
    workflowRunId: 'run.review',
    reviewNodeId: 'review.node',
    attemptId: target.attemptId,
    subject: target,
    reviewerTaskId: 'task.review.a',
    reviewerAttemptId: 'attempt.review.a',
    reviewerRoleInstanceId: 'role-instance.review.a',
    status: 'approved',
    findings: [],
    summary: 'Approved.',
    createdAt: '2026-07-28T14:05:00Z'
  }
}

function recordReviewCommand(review: ReviewDecision): SchedulerCommand {
  return {
    schemaVersion: '1.0.0',
    commandId: `command.${review.id}.${review.subject.resultHash.slice(0, 8)}`,
    issuedAt: review.createdAt,
    workflowRunId: review.workflowRunId,
    taskId: 'task.review.a',
    actor: {
      kind: 'executor',
      roleInstanceId: 'role-instance.review.a',
      attemptId: 'attempt.review.a',
      executorInvocationId: 'invocation.review.a'
    },
    type: 'record_review',
    attemptId: 'attempt.review.a',
    review
  }
}

function announceNextAttemptCommand(): SchedulerCommand {
  return {
    schemaVersion: '1.0.0',
    commandId: 'command.announce.implementation.3',
    issuedAt: '2026-07-28T14:10:00Z',
    workflowRunId: 'run.review',
    taskId: subject.taskId,
    actor: { kind: 'scheduler', schedulerId: 'scheduler.1' },
    type: 'announce_execution',
    claimId: 'claim.implementation.3',
    attemptId: 'attempt.implementation.3',
    previousAttemptId: subject.attemptId,
    executorInstanceId: 'executor.developer'
  }
}

function recordAggregationCommand(aggregation: ReviewAggregation): SchedulerCommand {
  return {
    schemaVersion: '1.0.0',
    commandId: 'command.review.aggregate.a',
    issuedAt: aggregation.createdAt,
    workflowRunId: aggregation.workflowRunId,
    taskId: aggregation.subject.taskId,
    actor: { kind: 'scheduler', schedulerId: 'scheduler.1' },
    type: 'record_review_aggregation',
    aggregation
  }
}
