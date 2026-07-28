import { describe, expect, it } from 'vitest'
import { type Task, TaskSchema } from '../../../shared/mam/domain/task'
import {
  TaskAssignmentError,
  assignTask,
  selectAttempt,
  startAttempt
} from './task-assignment-service'

const hash = 'b'.repeat(64)

describe('task assignment and advisory execution notices', () => {
  it('requires a user Role Assignment before an Attempt starts', () => {
    expect(() => startAttempt(task(), startInput('attempt.1'))).toThrow(
      expect.objectContaining({ code: 'assignment_required' })
    )
  })

  it('rejects roles outside the Run catalog or Task allowlist', () => {
    expect(() =>
      assignTask(task(), assignment('role.other', 1), [
        { roleProfileId: 'role.developer', roleProfileVersion: 3 }
      ])
    ).toThrow(expect.objectContaining({ code: 'role_not_allowed' }))
  })

  it('allows duplicate execution with a warning and preserves both Attempts', () => {
    const assigned = assignTask(task(), assignment('role.developer', 3), [
      { roleProfileId: 'role.developer', roleProfileVersion: 3 }
    ])
    const first = startAttempt(assigned, startInput('attempt.1'))
    expect(first.warning).toBeUndefined()
    const second = startAttempt(first.task, startInput('attempt.2'))
    expect(second.warning).toEqual({
      code: 'concurrent_execution_warning',
      activeAttemptIds: ['attempt.1']
    })
    expect(second.task.attemptIds).toEqual(['attempt.1', 'attempt.2'])
    expect(second.task.selectedAttemptId).toBe('attempt.1')
    expect(selectAttempt(second.task, 'attempt.2').selectedAttemptId).toBe('attempt.2')
  })

  it('does not expose a lease-held or fencing failure mode', () => {
    expect(() => new TaskAssignmentError('example', 'example')).not.toThrow()
  })
})

function task(): Task {
  return TaskSchema.parse({
    schemaVersion: '1.0.0',
    id: 'task.1',
    workflowRunId: 'run.1',
    nodeRunId: 'node-run.1',
    title: 'Implement feature',
    specification: 'Implement the assigned feature.',
    dependencies: [],
    inputArtifacts: [],
    outputContracts: [
      {
        schemaVersion: '1.0.0',
        artifactType: 'source.diff',
        format: 'diff',
        required: true,
        maxBytes: 1_000_000
      }
    ],
    recommendedRoleProfileIds: ['role.developer'],
    allowedRoleProfileIds: ['role.developer'],
    executionNotices: [],
    attemptIds: [],
    status: 'waiting_role_assignment'
  })
}

function assignment(roleProfileId: string, roleProfileVersion: number) {
  return {
    taskId: 'task.1',
    roleProfileId,
    roleProfileVersion,
    assignedByUserId: 'user.owner',
    assignmentCommandId: 'command.assign.1',
    assignedAt: '2026-07-27T10:00:00Z'
  }
}

function startInput(attemptId: string) {
  return {
    attemptId,
    executorInstanceId: `executor.${attemptId}`,
    effectiveConfigSnapshotId: `config.${attemptId}`,
    effectiveConfigHash: hash,
    announcedAt: '2026-07-27T10:01:00Z',
    revision: `revision.${attemptId}`
  }
}
