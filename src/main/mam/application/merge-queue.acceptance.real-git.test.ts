import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { MergeQueueEntry } from '../../../shared/mam/domain/merge-queue'
import type { WorkflowDefinition } from '../../../shared/mam/domain/workflow'
import { ConflictResolutionWorktreeManager } from './conflict-resolution-worktree-manager'
import { IntegrationWorktreeMergeExecutor } from './integration-worktree-merge-executor'
import {
  createMergeConflictResolution,
  createMergeConflictTask
} from './merge-conflict-task-service'
import { MergeQueue } from './merge-queue-service'
import { createWorkflowRunBundle } from './workflow-run-factory'

const hash = 'a'.repeat(64)
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('M6 Merge Queue acceptance with Git', () => {
  it('serially merges three ready tasks and resolves one coordinator conflict', () => {
    const fixture = parallelTaskRepository()
    const entries = [
      queueEntry('task.b', fixture.taskB, 'tasks/b', '2026-07-28T18:01:00Z'),
      queueEntry('task.a', fixture.taskA, 'tasks/a', '2026-07-28T18:01:00Z'),
      queueEntry('task.c', fixture.taskC, 'tasks/c', '2026-07-28T18:00:00Z')
    ]
    let queue = MergeQueue.create(entries)
    const observedOrder: string[] = []
    const mergeExecutor = new IntegrationWorktreeMergeExecutor()
    const integrationRoot = join(fixture.root, 'integration')

    let claim = queue.claimNext('2026-07-28T18:02:00Z')
    const taskC = requiredClaim(claim.entry)
    observedOrder.push(taskC.taskId)
    const taskCResult = mergeExecutor.execute(
      executionInput(fixture.repository, integrationRoot, taskC)
    )
    if (taskCResult.status !== 'merged') throw new Error(JSON.stringify(taskCResult))
    queue = claim.queue.markMerged(taskC.id, taskCResult.mergeCommit, '2026-07-28T18:03:00Z')

    claim = queue.claimNext('2026-07-28T18:04:00Z')
    const taskA = requiredClaim(claim.entry)
    observedOrder.push(taskA.taskId)
    const taskAResult = mergeExecutor.execute(
      executionInput(fixture.repository, integrationRoot, taskA)
    )
    if (taskAResult.status !== 'conflict') throw new Error(JSON.stringify(taskAResult))
    const conflictTask = createMergeConflictTask({
      bundle: mergeBundle(),
      entry: taskA,
      result: taskAResult,
      createdAt: '2026-07-28T18:05:00Z'
    })
    queue = claim.queue.markConflict(taskA.id, conflictTask.id, conflictTask.createdAt)

    const conflictManager = new ConflictResolutionWorktreeManager()
    const conflictInput = {
      repositoryPath: fixture.repository,
      integrationRoot,
      remoteName: 'origin',
      task: conflictTask
    }
    const prepared = conflictManager.prepare(conflictInput)
    writeFileSync(join(prepared.worktreePath, 'shared.txt'), 'coordinator resolution\n')
    git(prepared.worktreePath, ['add', 'shared.txt'])
    git(prepared.worktreePath, ['commit', '-m', 'resolve task.a conflict'])
    const resolutionCommit = git(prepared.worktreePath, ['rev-parse', 'HEAD'])
    const resolutionResult = conflictManager.finalize({
      ...conflictInput,
      resolutionAttemptId: 'attempt.conflict.task.a',
      resolutionCommit,
      completedAt: '2026-07-28T18:06:00Z'
    })
    if (resolutionResult.status !== 'merged') throw new Error(JSON.stringify(resolutionResult))
    const resolution = createMergeConflictResolution({
      task: conflictTask,
      result: resolutionResult
    })
    queue = queue.markConflictResolved(taskA.id, resolution)

    claim = queue.claimNext('2026-07-28T18:07:00Z')
    const taskB = requiredClaim(claim.entry)
    observedOrder.push(taskB.taskId)
    const taskBResult = mergeExecutor.execute(
      executionInput(fixture.repository, integrationRoot, taskB)
    )
    if (taskBResult.status !== 'merged') throw new Error(JSON.stringify(taskBResult))
    queue = claim.queue.markMerged(taskB.id, taskBResult.mergeCommit, '2026-07-28T18:08:00Z')

    expect(observedOrder).toEqual(['task.c', 'task.a', 'task.b'])
    expect(queue.list().map((entry) => entry.status)).toEqual(['merged', 'merged', 'merged'])
    expect(queue.list().find((entry) => entry.taskId === 'task.a')).toMatchObject({
      conflictTaskId: conflictTask.id,
      resolutionAttemptId: resolution.resolutionAttemptId,
      mergeCommit: resolution.mergeCommit
    })
    git(fixture.repository, ['fetch', 'origin', 'develop'])
    expect(git(fixture.repository, ['show', 'origin/develop:task-c.txt'])).toBe('task c')
    expect(git(fixture.repository, ['show', 'origin/develop:task-b.txt'])).toBe('task b')
    expect(git(fixture.repository, ['show', 'origin/develop:shared.txt'])).toBe(
      'coordinator resolution'
    )
  })
})

function executionInput(repositoryPath: string, integrationRoot: string, entry: MergeQueueEntry) {
  return {
    repositoryPath,
    integrationRoot,
    remoteName: 'origin',
    entry,
    validationCommands: []
  }
}

function requiredClaim(entry: MergeQueueEntry | undefined): MergeQueueEntry {
  if (!entry) throw new Error('Expected a Merge Queue claim')
  return entry
}

function queueEntry(
  taskId: string,
  submittedCommit: string,
  sourceBranch: string,
  mergeReadyAt: string
): MergeQueueEntry {
  return {
    schemaVersion: '1.0.0',
    id: `merge-entry.${taskId}`,
    workflowRunId: 'run.merge-acceptance',
    mergeNodeId: 'merge',
    taskId,
    attemptId: `attempt.${taskId}`,
    targetBranch: 'develop',
    sourceBranch,
    submittedCommit,
    resultHash: hash,
    mergeReadyAt,
    readyRevisionHash: hash,
    reviewDecisionIds: [`review.${taskId}`],
    validationEvidence: {},
    strategy: 'no_ff',
    conflictPolicy: 'coordinator_attempt',
    status: 'queued'
  }
}

function parallelTaskRepository() {
  const root = mkdtempSync(join(tmpdir(), 'mam-merge-acceptance-'))
  temporaryDirectories.push(root)
  const remote = join(root, 'remote.git')
  const repository = join(root, 'repository')
  mkdirSync(remote)
  git(remote, ['init', '--bare'])
  git(root, ['clone', remote, repository])
  git(repository, ['config', 'user.name', 'MAM Acceptance Test'])
  git(repository, ['config', 'user.email', 'mam-acceptance@example.invalid'])
  writeFileSync(join(repository, 'shared.txt'), 'base\n')
  git(repository, ['add', '.'])
  git(repository, ['commit', '-m', 'base'])
  git(repository, ['branch', '-M', 'develop'])
  git(repository, ['push', '-u', 'origin', 'develop'])
  const base = git(repository, ['rev-parse', 'HEAD'])

  writeFileSync(join(repository, 'shared.txt'), 'target\n')
  git(repository, ['commit', '-am', 'target change'])
  git(repository, ['push', 'origin', 'develop'])
  const taskA = createTaskBranch(repository, base, 'tasks/a', 'shared.txt', 'task a\n')
  const taskB = createTaskBranch(repository, base, 'tasks/b', 'task-b.txt', 'task b\n')
  const taskC = createTaskBranch(repository, base, 'tasks/c', 'task-c.txt', 'task c\n')
  git(repository, ['switch', 'develop'])
  return { root, repository, taskA, taskB, taskC }
}

function createTaskBranch(
  repository: string,
  base: string,
  branch: string,
  file: string,
  content: string
): string {
  git(repository, ['switch', '-c', branch, base])
  writeFileSync(join(repository, file), content)
  git(repository, ['add', file])
  git(repository, ['commit', '-m', branch])
  git(repository, ['push', '-u', 'origin', branch])
  return git(repository, ['rev-parse', 'HEAD'])
}

function mergeBundle() {
  return createWorkflowRunBundle({
    runId: 'run.merge-acceptance',
    definition: mergeWorkflow(),
    roleCatalog: [{ roleProfileId: 'role.coordinator', roleProfileVersion: 1, contentHash: hash }],
    createdAt: '2026-07-28T17:00:00Z'
  })
}

function mergeWorkflow(): WorkflowDefinition {
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.merge-acceptance',
    name: 'Merge acceptance',
    version: 1,
    nodes: [
      {
        id: 'merge',
        type: 'git_merge',
        recommendedRoleProfileIds: ['role.coordinator'],
        allowedRoleProfileIds: ['role.coordinator'],
        targetBranch: 'develop',
        orderBy: 'merge_ready_at',
        strategy: 'no_ff',
        conflictPolicy: 'coordinator_attempt',
        validations: []
      },
      { id: 'finish', type: 'finish', inputs: [] }
    ],
    edges: [{ from: 'merge', to: 'finish' }],
    maxTransitions: 20,
    maxRunCostUsd: 20,
    maxRunDurationSeconds: 3600
  }
}

function git(directory: string, args: readonly string[]): string {
  return execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {
    cwd: directory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}
