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
              roleCatalogVersions: new Map([['role.developer', new Set([1])]])
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

function recoveryCommand(
  directive: { kind: 'start_new_attempt'; newAttemptId: string } | { kind: 'needs_reconciliation' }
): SchedulerCommand {
  return {
    ...baseCommand(`command.recover.${directive.kind}`),
    actor: { kind: 'scheduler', schedulerId: 'scheduler.1' },
    type: 'recover_attempt',
    previousAttemptId: 'attempt.old',
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
