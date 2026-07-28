import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { MergeConflictTaskDefinition } from '../../../shared/mam/domain/merge-conflict-task'
import { ConflictResolutionWorktreeManager } from './conflict-resolution-worktree-manager'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('ConflictResolutionWorktreeManager with Git', () => {
  it('reproduces the pinned conflict and pushes a validated two-parent resolution', () => {
    const fixture = conflictRepository()
    const task = conflictTask(fixture)
    const manager = new ConflictResolutionWorktreeManager()
    const input = {
      repositoryPath: fixture.repository,
      integrationRoot: join(fixture.root, 'integration'),
      remoteName: 'origin',
      task
    }
    const prepared = manager.prepare(input)
    expect(prepared.conflictingPaths).toEqual(['shared.txt'])

    writeFileSync(join(prepared.worktreePath, 'shared.txt'), 'resolved\n')
    git(prepared.worktreePath, ['add', 'shared.txt'])
    git(prepared.worktreePath, ['commit', '-m', 'resolve merge conflict'])
    const resolutionCommit = git(prepared.worktreePath, ['rev-parse', 'HEAD'])
    const result = manager.finalize({
      ...input,
      resolutionAttemptId: 'attempt.conflict.1',
      resolutionCommit,
      completedAt: '2026-07-28T18:10:00Z'
    })

    expect(result).toMatchObject({
      status: 'merged',
      queueEntryId: task.queueEntryId,
      conflictTaskId: task.id,
      resolutionAttemptId: 'attempt.conflict.1',
      mergeCommit: resolutionCommit
    })
    git(fixture.repository, ['fetch', 'origin', 'develop'])
    expect(git(fixture.repository, ['rev-parse', 'origin/develop'])).toBe(resolutionCommit)
    expect(git(fixture.repository, ['show', 'origin/develop:shared.txt'])).toBe('resolved')
  })

  it('retains unresolved work for rework and supports explicit cleanup', () => {
    const fixture = conflictRepository()
    const task = conflictTask(fixture)
    const manager = new ConflictResolutionWorktreeManager()
    const input = {
      repositoryPath: fixture.repository,
      integrationRoot: join(fixture.root, 'integration'),
      remoteName: 'origin',
      task
    }
    manager.prepare(input)
    const result = manager.finalize({
      ...input,
      resolutionAttemptId: 'attempt.conflict.1',
      resolutionCommit: task.targetCommit,
      completedAt: '2026-07-28T18:10:00Z'
    })
    expect(result).toMatchObject({
      status: 'failed',
      stage: 'lineage',
      worktreeRetained: true
    })
    expect(manager.abandon(input)).toBe(true)
  })
})

function conflictRepository() {
  const root = mkdtempSync(join(tmpdir(), 'mam-conflict-resolution-'))
  temporaryDirectories.push(root)
  const remote = join(root, 'remote.git')
  const repository = join(root, 'repository')
  mkdirSync(remote)
  git(remote, ['init', '--bare'])
  git(root, ['clone', remote, repository])
  git(repository, ['config', 'user.name', 'MAM Conflict Test'])
  git(repository, ['config', 'user.email', 'mam-conflict-test@example.invalid'])
  writeFileSync(join(repository, 'shared.txt'), 'base\n')
  git(repository, ['add', '.'])
  git(repository, ['commit', '-m', 'base'])
  git(repository, ['branch', '-M', 'develop'])
  git(repository, ['push', '-u', 'origin', 'develop'])
  const mergeBase = git(repository, ['rev-parse', 'HEAD'])

  git(repository, ['switch', '-c', 'tasks/feature'])
  writeFileSync(join(repository, 'shared.txt'), 'source\n')
  git(repository, ['commit', '-am', 'source change'])
  const submittedCommit = git(repository, ['rev-parse', 'HEAD'])
  git(repository, ['push', '-u', 'origin', 'tasks/feature'])

  git(repository, ['switch', 'develop'])
  writeFileSync(join(repository, 'shared.txt'), 'target\n')
  git(repository, ['commit', '-am', 'target change'])
  const targetCommit = git(repository, ['rev-parse', 'HEAD'])
  git(repository, ['push', 'origin', 'develop'])
  return { root, repository, mergeBase, submittedCommit, targetCommit }
}

function conflictTask(fixture: ReturnType<typeof conflictRepository>): MergeConflictTaskDefinition {
  return {
    schemaVersion: '1.0.0',
    id: 'merge-conflict-task.feature',
    workflowRunId: 'run.merge',
    mergeNodeId: 'merge',
    queueEntryId: 'merge-entry.feature',
    parentTaskId: 'task.feature',
    parentAttemptId: 'attempt.feature',
    targetBranch: 'develop',
    sourceBranch: 'tasks/feature',
    targetCommit: fixture.targetCommit,
    submittedCommit: fixture.submittedCommit,
    mergeBase: fixture.mergeBase,
    conflictingPaths: ['shared.txt'],
    validationCommands: ['git diff --check HEAD^1 HEAD'],
    recommendedRoleProfileIds: ['role.coordinator'],
    allowedRoleProfileIds: ['role.coordinator'],
    initialStatus: 'waiting_role_assignment',
    createdAt: '2026-07-28T18:02:00Z'
  }
}

function git(directory: string, args: readonly string[]): string {
  return execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {
    cwd: directory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}
