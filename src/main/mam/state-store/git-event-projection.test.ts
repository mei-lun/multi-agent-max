import { describe, expect, it } from 'vitest'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import { SchedulerKernel } from '../scheduler/kernel'
import {
  emptyWorkflowRunProjection,
  listTasksForRole,
  replayWorkflowRun,
  schedulerContextFromProjection
} from './git-event-projection'

describe('Git event projection', () => {
  it('replays out-of-order input to the same revision and state hash', () => {
    const kernel = new SchedulerKernel()
    const createBatch = kernel.execute(createRunCommand(), {
      schedulerId: 'scheduler.1',
      validArtifactHashes: new Set(),
      processedCommandIds: new Set(),
      mergeQueueEntries: new Map()
    })
    const afterCreate = replayWorkflowRun('run.1', createBatch.events)
    const assignmentBatch = kernel.execute(
      assignmentCommand('command.assign.a', 'task.a'),
      schedulerContextFromProjection(afterCreate, {
        schedulerId: 'scheduler.1',
        taskId: 'task.a',
        taskDefinition: taskDefinition()
      })
    )
    const events = [...createBatch.events, ...assignmentBatch.events]
    const forward = replayWorkflowRun('run.1', events)
    const reversed = replayWorkflowRun('run.1', [...events].reverse())

    expect(reversed).toEqual(forward)
    expect(forward.tasks['task.a']).toMatchObject({
      status: 'ready',
      roleProfileId: 'role.developer'
    })
    expect(listTasksForRole(forward, 'role.developer').map((entry) => entry.taskId)).toEqual([
      'task.a'
    ])
    expect(forward.revision).not.toBe(emptyWorkflowRunProjection('run.1').revision)
  })

  it('rejects an event whose parent revision is unknown', () => {
    const event = new SchedulerKernel().execute(createRunCommand(), {
      schedulerId: 'scheduler.1',
      validArtifactHashes: new Set(),
      processedCommandIds: new Set(),
      mergeQueueEntries: new Map()
    }).events[0]!
    expect(() =>
      replayWorkflowRun('run.1', [{ ...event, parentRevision: 'f'.repeat(64) }])
    ).toThrow(expect.objectContaining({ code: 'parent_revision_mismatch' }))
  })

  it('rebuilds a cancelled Run from an append-only user event', () => {
    const kernel = new SchedulerKernel()
    const createBatch = kernel.execute(createRunCommand(), {
      schedulerId: 'scheduler.1',
      validArtifactHashes: new Set(),
      processedCommandIds: new Set(),
      mergeQueueEntries: new Map()
    })
    const created = replayWorkflowRun('run.1', createBatch.events)
    const cancelBatch = kernel.execute(
      {
        schemaVersion: '1.0.0',
        commandId: 'command.cancel',
        issuedAt: '2026-07-27T12:02:00Z',
        workflowRunId: 'run.1',
        actor: { kind: 'user', userId: 'user.owner' },
        type: 'cancel_workflow_run',
        reason: 'Start over.'
      },
      schedulerContextFromProjection(created, { schedulerId: 'scheduler.1' })
    )
    const cancelled = replayWorkflowRun('run.1', [...createBatch.events, ...cancelBatch.events])

    expect(cancelled.cancellation).toMatchObject({
      userId: 'user.owner',
      reason: 'Start over.'
    })
  })
})

function createRunCommand(): SchedulerCommand {
  return {
    schemaVersion: '1.0.0',
    commandId: 'command.create',
    issuedAt: '2026-07-27T12:00:00Z',
    workflowRunId: 'run.1',
    actor: { kind: 'scheduler', schedulerId: 'scheduler.1' },
    type: 'create_workflow_run',
    definitionId: 'workflow.1',
    definitionVersion: 1,
    planHash: 'a'.repeat(64),
    roleCatalogHash: 'b'.repeat(64)
  }
}

function taskDefinition() {
  return {
    initialStatus: 'waiting_role_assignment' as const,
    allowedRoleProfileIds: ['role.developer'],
    roleCatalogVersions: new Map([['role.developer', new Set([1])]])
  }
}

function assignmentCommand(commandId: string, taskId: string): SchedulerCommand {
  return {
    schemaVersion: '1.0.0',
    commandId,
    issuedAt: '2026-07-27T12:01:00Z',
    workflowRunId: 'run.1',
    taskId,
    actor: { kind: 'user', userId: 'user.owner' },
    type: 'assign_task',
    roleProfileId: 'role.developer',
    roleProfileVersion: 1
  }
}
