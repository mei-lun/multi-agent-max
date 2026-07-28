import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import { GitCommandConflictStore } from './git-command-conflict-store'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('GitCommandConflictStore', () => {
  it('persists an original command and consumes it only with resolution metadata', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mam-command-conflict-'))
    directories.push(directory)
    const path = join(directory, 'conflicts.json')
    const store = new GitCommandConflictStore(path)
    const conflict = store.record({
      command: assignmentCommand(),
      baseRevision: 'a'.repeat(64),
      latestRevision: 'b'.repeat(64),
      latestCommit: 'abcdef1',
      failureCode: 'invalid_transition',
      failureMessage: 'task already assigned',
      createdAt: '2026-07-27T13:00:00Z'
    })

    expect(new GitCommandConflictStore(path).requirePending(conflict.conflictId).command).toEqual(
      assignmentCommand()
    )
    store.consume(conflict.conflictId, {
      resolutionCommandId: 'command.resolve',
      resolvedByUserId: 'user.owner',
      consumedAt: '2026-07-27T13:01:00Z'
    })
    expect(new GitCommandConflictStore(path).list('pending')).toEqual([])
    expect(new GitCommandConflictStore(path).list('consumed')[0]).toMatchObject({
      resolutionCommandId: 'command.resolve',
      resolvedByUserId: 'user.owner'
    })
  })
})

function assignmentCommand(): SchedulerCommand {
  return {
    schemaVersion: '1.0.0',
    commandId: 'command.assign',
    issuedAt: '2026-07-27T13:00:00Z',
    workflowRunId: 'run.1',
    taskId: 'task.1',
    actor: { kind: 'user', userId: 'user.owner' },
    type: 'assign_task',
    roleProfileId: 'role.developer',
    roleProfileVersion: 1
  }
}
