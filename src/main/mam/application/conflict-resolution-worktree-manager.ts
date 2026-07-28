import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { MergeConflictTaskDefinition } from '../../../shared/mam/domain/merge-conflict-task'
import { createGitCommandClient, type GitCommandClient } from '../state-store/git-command-client'
import {
  runValidationCommand,
  type ValidationCommandResult,
  type ValidationCommandRunner
} from './validation-command-runner'

export type ConflictWorktreePreparation = Readonly<{
  worktreePath: string
  conflictingPaths: readonly string[]
}>

export type ConflictResolutionResult =
  | Readonly<{
      status: 'merged'
      queueEntryId: string
      conflictTaskId: string
      resolutionAttemptId: string
      mergeCommit: string
      completedAt: string
      validations: readonly ValidationCommandResult[]
      cleanupWarning?: string
    }>
  | Readonly<{
      status: 'failed'
      stage: 'preflight' | 'lineage' | 'validation' | 'target_refresh' | 'push'
      reason: string
      validations: readonly ValidationCommandResult[]
      worktreeRetained: true
    }>

type ConflictWorktreeInput = Readonly<{
  repositoryPath: string
  integrationRoot: string
  remoteName: string
  task: MergeConflictTaskDefinition
}>

export class ConflictResolutionWorktreeManager {
  constructor(
    private readonly git: GitCommandClient = createGitCommandClient(),
    private readonly runValidation: ValidationCommandRunner = runValidationCommand
  ) {}

  prepare(input: ConflictWorktreeInput): ConflictWorktreePreparation {
    const worktreePath = expectedWorktreePath(input.integrationRoot, input.task.id)
    assertInput(input)
    if (existsSync(worktreePath)) throw new Error('Conflict worktree path already exists')
    mkdirSync(input.integrationRoot, { recursive: true })
    fetchPinnedBranches(this.git, input)
    const remoteTarget = revision(
      this.git,
      input.repositoryPath,
      remoteRef(input.remoteName, input.task.targetBranch)
    )
    if (remoteTarget !== input.task.targetCommit) {
      throw new Error('Target branch changed after conflict detection')
    }
    this.git.run(input.repositoryPath, [
      'worktree',
      'add',
      '--detach',
      worktreePath,
      input.task.targetCommit
    ])
    try {
      this.git.run(worktreePath, mergeArguments(input.task.submittedCommit))
      throw new Error('Pinned commits no longer reproduce a conflict')
    } catch (error) {
      const paths = unresolvedPaths(this.git, worktreePath)
      if (paths.length === 0) {
        this.git.succeeds(input.repositoryPath, ['worktree', 'remove', '--force', worktreePath])
        throw error
      }
      if (JSON.stringify(paths) !== JSON.stringify([...input.task.conflictingPaths].sort())) {
        this.git.succeeds(input.repositoryPath, ['worktree', 'remove', '--force', worktreePath])
        throw new Error('Reproduced conflict paths do not match Task evidence')
      }
      return { worktreePath, conflictingPaths: paths }
    }
  }

  finalize(
    input: ConflictWorktreeInput &
      Readonly<{ resolutionAttemptId: string; resolutionCommit: string; completedAt: string }>
  ): ConflictResolutionResult {
    const worktreePath = expectedWorktreePath(input.integrationRoot, input.task.id)
    const validations: ValidationCommandResult[] = []
    let stage: Extract<ConflictResolutionResult, { status: 'failed' }>['stage'] = 'preflight'
    try {
      assertInput(input)
      if (!existsSync(worktreePath)) throw new Error('Conflict worktree was not prepared')
      stage = 'lineage'
      if (unresolvedPaths(this.git, worktreePath).length > 0) {
        throw new Error('Conflict worktree still contains unmerged paths')
      }
      const head = revision(this.git, worktreePath, 'HEAD')
      if (head !== input.resolutionCommit) throw new Error('Resolution commit is not worktree HEAD')
      assertMergeParents(this.git, worktreePath, input.task, head)
      stage = 'validation'
      for (const command of input.task.validationCommands) {
        const result = this.runValidation(command, worktreePath)
        validations.push(result)
        if (result.exitCode !== 0) throw new Error(`Validation failed: ${command}`)
      }
      stage = 'target_refresh'
      fetchPinnedBranches(this.git, input)
      const currentTarget = revision(
        this.git,
        input.repositoryPath,
        remoteRef(input.remoteName, input.task.targetBranch)
      )
      if (currentTarget !== input.task.targetCommit) {
        throw new Error('Target branch changed before conflict resolution push')
      }
      stage = 'push'
      this.git.run(worktreePath, [
        'push',
        input.remoteName,
        `HEAD:refs/heads/${input.task.targetBranch}`
      ])
      const outcome: Extract<ConflictResolutionResult, { status: 'merged' }> = {
        status: 'merged',
        queueEntryId: input.task.queueEntryId,
        conflictTaskId: input.task.id,
        resolutionAttemptId: input.resolutionAttemptId,
        mergeCommit: head,
        completedAt: input.completedAt,
        validations
      }
      return this.cleanup(input.repositoryPath, worktreePath, outcome)
    } catch (error) {
      return {
        status: 'failed',
        stage,
        reason: errorMessage(error),
        validations,
        worktreeRetained: true
      }
    }
  }

  abandon(input: ConflictWorktreeInput): boolean {
    const path = expectedWorktreePath(input.integrationRoot, input.task.id)
    return (
      !existsSync(path) ||
      this.git.succeeds(input.repositoryPath, ['worktree', 'remove', '--force', path])
    )
  }

  private cleanup(
    repositoryPath: string,
    worktreePath: string,
    outcome: Extract<ConflictResolutionResult, { status: 'merged' }>
  ): Extract<ConflictResolutionResult, { status: 'merged' }> {
    return this.git.succeeds(repositoryPath, ['worktree', 'remove', '--force', worktreePath])
      ? outcome
      : { ...outcome, cleanupWarning: 'Conflict worktree cleanup failed' }
  }
}

function assertInput(input: ConflictWorktreeInput): void {
  if (!isAbsolute(input.repositoryPath) || !isAbsolute(input.integrationRoot)) {
    throw new Error('Repository and integration worktree paths must be absolute')
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.remoteName)) {
    throw new Error('Git remote name is invalid')
  }
}

function fetchPinnedBranches(git: GitCommandClient, input: ConflictWorktreeInput): void {
  git.run(input.repositoryPath, ['check-ref-format', `refs/heads/${input.task.targetBranch}`])
  git.run(input.repositoryPath, ['check-ref-format', `refs/heads/${input.task.sourceBranch}`])
  git.run(input.repositoryPath, [
    'fetch',
    '--no-tags',
    input.remoteName,
    `+refs/heads/${input.task.targetBranch}:refs/remotes/${input.remoteName}/${input.task.targetBranch}`,
    `+refs/heads/${input.task.sourceBranch}:refs/remotes/${input.remoteName}/${input.task.sourceBranch}`
  ])
  const source = revision(
    git,
    input.repositoryPath,
    remoteRef(input.remoteName, input.task.sourceBranch)
  )
  git.run(input.repositoryPath, ['merge-base', '--is-ancestor', input.task.submittedCommit, source])
}

function assertMergeParents(
  git: GitCommandClient,
  worktreePath: string,
  task: MergeConflictTaskDefinition,
  head: string
): void {
  const [commit, ...parents] = git
    .run(worktreePath, ['rev-list', '--parents', '-n', '1', head])
    .split(' ')
  if (
    commit !== head ||
    parents.length !== 2 ||
    parents[0] !== task.targetCommit ||
    parents[1] !== task.submittedCommit
  ) {
    throw new Error('Resolution commit does not preserve both pinned parents')
  }
}

function mergeArguments(submittedCommit: string): string[] {
  return [
    '-c',
    'user.name=MAM Merge Scheduler',
    '-c',
    'user.email=mam-merge@example.invalid',
    'merge',
    '--no-ff',
    '--no-edit',
    submittedCommit
  ]
}

function revision(git: GitCommandClient, directory: string, ref: string): string {
  return git.run(directory, ['rev-parse', '--verify', `${ref}^{commit}`])
}

function remoteRef(remoteName: string, branch: string): string {
  return `refs/remotes/${remoteName}/${branch}`
}

function expectedWorktreePath(root: string, taskId: string): string {
  const digest = createHash('sha256').update(taskId).digest('hex').slice(0, 24)
  return join(root, `conflict-${digest}`)
}

function unresolvedPaths(git: GitCommandClient, directory: string): string[] {
  return git
    .run(directory, ['diff', '--name-only', '--diff-filter=U', '-z'])
    .split('\0')
    .filter(Boolean)
    .sort()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
