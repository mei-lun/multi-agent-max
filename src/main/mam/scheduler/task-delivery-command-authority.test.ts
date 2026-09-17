import { describe, expect, it } from 'vitest'
import type { ReviewSubject } from '../../../shared/mam/domain/review'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import type { SchedulerKernelContext, SchedulerTaskContext } from './scheduler-kernel-context'
import { assertTaskDeliveryAuthority } from './task-delivery-command-authority'

describe('assertTaskDeliveryAuthority', () => {
  it('requires every direct dependency Delivery in the lineage', () => {
    expect(() => assertTaskDeliveryAuthority(command(), task(), context())).toThrow(
      expect.objectContaining({ code: 'input_lineage_incomplete' })
    )
  })

  it('requires a bound Review decision in the same Reviewer Delivery', () => {
    const subject = reviewSubject()
    expect(() =>
      assertTaskDeliveryAuthority(
        command([{ taskId: subject.taskId, attemptId: subject.attemptId }]),
        task({ reviewTarget: subject, reviewNodeId: 'review.security' }),
        context([[subject.taskId, subject.attemptId]])
      )
    ).toThrow(expect.objectContaining({ code: 'review_required' }))
  })
})

function command(
  inputDeliveries: readonly { taskId: string; attemptId: string }[] = []
): Extract<SchedulerCommand, { type: 'record_task_delivery' }> {
  return {
    schemaVersion: '1.0.0', commandId: 'command.delivery', issuedAt: '2026-09-17T12:00:00Z',
    workflowRunId: 'run.1', taskId: 'task.1',
    actor: { kind: 'executor', roleInstanceId: 'role.1', attemptId: 'attempt.1', executorInvocationId: 'invocation.1' },
    type: 'record_task_delivery', claimId: 'claim.1', generation: 1, attemptId: 'attempt.1',
    lineageKind: 'initial', revisionNumber: 0, roleInstanceId: 'role.1',
    executorInvocationId: 'invocation.1', effectiveConfigSnapshotId: 'effective.1',
    effectiveConfigHash: 'a'.repeat(64), inputDeliveries,
    result: {
      system: { workflowRunId: 'run.1', nodeRunId: 'node-run.1', taskId: 'task.1', attemptId: 'attempt.1', roleInstanceId: 'role.1', executorInvocationId: 'invocation.1', effectiveConfigHash: 'a'.repeat(64) },
      artifacts: []
    }
  } as unknown as Extract<SchedulerCommand, { type: 'record_task_delivery' }>
}

function task(extra: Partial<SchedulerTaskContext> = {}): SchedulerTaskContext {
  return {
    workflowRunId: 'run.1', taskId: 'task.1', status: 'ready',
    activeClaim: { schemaVersion: '1.0.0', claimId: 'claim.1', taskId: 'task.1', roleProfileId: 'role.profile', roleProfileVersion: 1, claimantInstanceId: 'claimant.1', generation: 1, claimedAt: '2026-09-17T11:00:00Z' },
    activeAttemptIds: new Set(), knownAttemptIds: new Set(), submittedAttemptIds: new Set(),
    attemptBindings: new Map(), allowedRoleProfileIds: new Set(), roleCatalogVersions: new Map(),
    reviewDecisions: new Map(), requiredInputTaskIds: new Set(['task.upstream']), ...extra
  }
}

function context(deliveries: readonly (readonly [string, string])[] = [['task.upstream', 'attempt.upstream']]): SchedulerKernelContext {
  return { schedulerId: 'scheduler.desktop', validArtifactHashes: new Set(), processedCommandIds: new Set(), mergeQueueEntries: new Map(), taskCurrentDeliveryIds: new Map(deliveries) }
}

function reviewSubject(): ReviewSubject {
  return { taskId: 'task.subject', attemptId: 'attempt.subject', resultHash: 'b'.repeat(64), artifactHashes: [] }
}
