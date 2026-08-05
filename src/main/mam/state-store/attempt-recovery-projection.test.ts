import { describe, expect, it } from 'vitest'
import type { SchedulerCommand, SchedulerEvent } from '../../../shared/mam/scheduler-protocol'
import { SchedulerKernel } from '../scheduler/kernel'
import {
  emptyWorkflowRunProjection,
  replayWorkflowRun,
  schedulerContextFromProjection,
  type WorkflowRunProjection
} from './git-event-projection'

describe('Attempt recovery projection', () => {
  it('blocks the crashed Attempt and creates a distinct replacement Attempt', () => {
    const run = new RecoveryRun()
    run.execute(assignmentCommand())
    run.execute(announcementCommand('attempt.old'))
    run.execute(recoveryCommand({ kind: 'start_new_attempt', newAttemptId: 'attempt.new' }))

    expect(run.projection.attempts['attempt.old']?.status).toBe('blocked')
    expect(run.projection.attempts['attempt.new']?.status).toBe('recovery_planned')
    expect(run.projection.tasks['task.recovery']).toMatchObject({
      status: 'ready',
      roleProfileId: 'role.developer',
      roleProfileVersion: 1,
      activeAttemptIds: [],
      knownAttemptIds: ['attempt.old', 'attempt.new']
    })

    run.execute(announcementCommand('attempt.new'))
    expect(run.projection.attempts['attempt.new']?.status).toBe('announced')
  })

  it('requires reconciliation instead of replaying an unknown side effect', () => {
    const run = new RecoveryRun()
    run.execute(assignmentCommand())
    run.execute(announcementCommand('attempt.old'))
    run.execute(recoveryCommand({ kind: 'needs_reconciliation' }))

    expect(run.projection.attempts['attempt.old']?.status).toBe('needs_reconciliation')
    expect(run.projection.tasks['task.recovery']?.status).toBe('needs_attention')
    expect(() => run.execute(announcementCommand('attempt.unsafe'))).toThrow(
      expect.objectContaining({ code: 'reconciliation_required' })
    )
    expect(() =>
      run.execute(recoveryCommand({ kind: 'start_new_attempt', newAttemptId: 'attempt.new' }))
    ).toThrow(expect.objectContaining({ code: 'user_authority_required' }))

    run.execute(reconciliationResolutionCommand())
    expect(run.projection.tasks['task.recovery']?.status).toBe('ready')
    expect(run.projection.attempts['attempt.old']?.status).toBe('blocked')
    expect(run.projection.attempts['attempt.new']).toMatchObject({
      previousAttemptId: 'attempt.old',
      status: 'recovery_planned'
    })
  })

  it('requires every concurrent interruption to be reconciled before retry', () => {
    const run = new RecoveryRun()
    run.execute(assignmentCommand())
    run.execute(announcementCommand('attempt.first'))
    run.execute(startCommand('attempt.first'))
    run.execute(announcementCommand('attempt.second'))
    run.execute(startCommand('attempt.second'))

    run.execute(recoveryCommand({ kind: 'needs_reconciliation' }, 'attempt.first'))
    expect(run.projection.tasks['task.recovery']).toMatchObject({
      status: 'needs_attention',
      activeAttemptIds: ['attempt.second']
    })
    expect(() => run.execute(resultCommand('attempt.first'))).toThrow(
      expect.objectContaining({ code: 'stale_attempt' })
    )
    expect(() => run.execute(resultCommand('attempt.second'))).toThrow(
      expect.objectContaining({ code: 'reconciliation_required' })
    )
    run.execute(recoveryCommand({ kind: 'needs_reconciliation' }, 'attempt.second'))
    expect(run.projection.tasks['task.recovery']?.activeAttemptIds).toEqual([])

    run.execute(reconciliationResolutionCommand('attempt.first', 'attempt.first-replacement'))
    expect(run.projection.tasks['task.recovery']?.status).toBe('needs_attention')

    run.execute(reconciliationResolutionCommand('attempt.second', 'attempt.second-replacement'))
    expect(run.projection.tasks['task.recovery']).toMatchObject({
      status: 'ready',
      roleProfileId: 'role.developer',
      roleProfileVersion: 1,
      activeAttemptIds: []
    })
    expect(run.projection.attempts['attempt.first-replacement']).toMatchObject({
      previousAttemptId: 'attempt.first',
      status: 'blocked'
    })
    expect(run.projection.attempts['attempt.second-replacement']).toMatchObject({
      previousAttemptId: 'attempt.second',
      status: 'recovery_planned'
    })
  })

  it('supersedes a recovery plan when another concurrent Attempt succeeds', () => {
    const run = new RecoveryRun()
    run.execute(assignmentCommand())
    run.execute(announcementCommand('attempt.interrupted'))
    run.execute(startCommand('attempt.interrupted'))
    run.execute(announcementCommand('attempt.successful'))
    run.execute(startCommand('attempt.successful'))
    run.execute(
      recoveryCommand(
        { kind: 'start_new_attempt', newAttemptId: 'attempt.unneeded-replacement' },
        'attempt.interrupted'
      )
    )

    run.execute(resultCommand('attempt.successful'))
    expect(run.projection.attempts['attempt.unneeded-replacement']?.status).toBe('blocked')
    expect(run.projection.tasks['task.recovery']).toMatchObject({
      status: 'submitted',
      selectedAttemptId: 'attempt.successful'
    })
  })
})

class RecoveryRun {
  readonly kernel = new SchedulerKernel()
  readonly events: SchedulerEvent[] = []
  projection: WorkflowRunProjection = emptyWorkflowRunProjection('run.recovery')

  execute(command: SchedulerCommand): void {
    const context = schedulerContextFromProjection(this.projection, {
      schedulerId: 'scheduler.1',
      ...('taskId' in command
        ? {
            taskId: command.taskId,
            taskDefinition: {
              initialStatus: 'waiting_role_assignment' as const,
              allowedRoleProfileIds: ['role.developer'],
              roleCatalogVersions: new Map([
                ['role.developer', new Set([1])],
                ['role.reviewer', new Set([2])]
              ])
            }
          }
        : {})
    })
    const batch = this.kernel.execute(command, context)
    this.events.push(...batch.events)
    this.projection = replayWorkflowRun('run.recovery', this.events)
  }
}

function assignmentCommand(): SchedulerCommand {
  return {
    ...baseCommand('command.assign'),
    actor: { kind: 'user', userId: 'user.owner' },
    type: 'assign_task',
    roleProfileId: 'role.developer',
    roleProfileVersion: 1
  }
}

function announcementCommand(attemptId: string): SchedulerCommand {
  return {
    ...baseCommand(`command.announce.${attemptId}`),
    actor: { kind: 'scheduler', schedulerId: 'scheduler.1' },
    type: 'announce_execution',
    claimId: `claim.${attemptId}`,
    attemptId,
    executorInstanceId: `executor.${attemptId}`
  }
}

function startCommand(attemptId: string): SchedulerCommand {
  return {
    ...baseCommand(`command.start.${attemptId}`),
    actor: { kind: 'scheduler', schedulerId: 'scheduler.1' },
    type: 'start_attempt',
    attemptId,
    roleInstanceId: `role-instance.${attemptId}`,
    executorInvocationId: `executor-invocation.${attemptId}`,
    effectiveConfigSnapshotId: `effective.${attemptId}`,
    effectiveConfigHash: 'a'.repeat(64)
  }
}

function resultCommand(attemptId: string): SchedulerCommand {
  return {
    ...baseCommand(`command.result.${attemptId}`),
    actor: {
      kind: 'executor',
      roleInstanceId: `role-instance.${attemptId}`,
      attemptId,
      executorInvocationId: `executor-invocation.${attemptId}`
    },
    type: 'submit_attempt_result',
    attemptId,
    result: {
      schemaVersion: '1.0.0',
      status: 'submitted',
      summary: 'Completed successfully.',
      verifications: [],
      risks: [],
      followUps: [],
      artifacts: [],
      usage: { status: 'unknown' },
      system: {
        workflowRunId: 'run.recovery',
        nodeRunId: 'node-run.recovery',
        taskId: 'task.recovery',
        attemptId,
        roleInstanceId: `role-instance.${attemptId}`,
        executorInvocationId: `executor-invocation.${attemptId}`,
        effectiveConfigHash: 'a'.repeat(64),
        submittedCommit: 'abcdef1',
        createdAt: '2026-07-27T14:05:00Z'
      }
    }
  }
}

function reconciliationResolutionCommand(
  previousAttemptId = 'attempt.old',
  newAttemptId = 'attempt.new'
): SchedulerCommand {
  return {
    ...baseCommand(`command.resolve-reconciliation.${previousAttemptId}`),
    actor: { kind: 'user', userId: 'user.owner' },
    type: 'recover_attempt',
    previousAttemptId,
    directive: { kind: 'start_new_attempt', newAttemptId },
    reason: 'Verified external state and confirmed replay is safe.'
  }
}

function recoveryCommand(
  directive: { kind: 'start_new_attempt'; newAttemptId: string } | { kind: 'needs_reconciliation' },
  previousAttemptId = 'attempt.old'
): SchedulerCommand {
  return {
    ...baseCommand(`command.recover.${previousAttemptId}.${directive.kind}`),
    actor: { kind: 'scheduler', schedulerId: 'scheduler.1' },
    type: 'recover_attempt',
    previousAttemptId,
    directive,
    reason: 'The Executor process exited without a terminal result.'
  }
}

function baseCommand(commandId: string) {
  return {
    schemaVersion: '1.0.0' as const,
    commandId,
    issuedAt: '2026-07-27T14:00:00Z',
    workflowRunId: 'run.recovery',
    taskId: 'task.recovery'
  }
}
