import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { createGitCommandClient, type GitCommandClient } from '../state-store/git-command-client'

export type AttemptWorktree = Readonly<{
  path: string
  branch: string
  baseCommit: string
}>

export type FinalizedAttemptWorktree = AttemptWorktree &
  Readonly<{
    submittedCommit: string
    changed: boolean
    cleanupWarning?: string
  }>

export class AttemptWorktreeError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'AttemptWorktreeError'
  }
}

export class AttemptWorktreeManager {
  constructor(private readonly git: GitCommandClient = createGitCommandClient()) {}

  prepare(input: {
    repositoryPath: string
    workspaceRoot: string
    remoteName: string | undefined
    attemptId: string
    baseRef: string
  }): AttemptWorktree {
    assertInput(input)
    const path = workspacePath(input.workspaceRoot, input.attemptId)
    if (existsSync(path)) throw new Error('Attempt worktree path already exists')
    mkdirSync(input.workspaceRoot, { recursive: true })
    const baseCommit = this.resolveBaseCommit(input.repositoryPath, input.remoteName, input.baseRef)
    const branch = attemptBranchName(input.attemptId)
    this.git.run(input.repositoryPath, ['check-ref-format', `refs/heads/${branch}`])
    this.git.run(input.repositoryPath, ['worktree', 'add', '-b', branch, path, baseCommit])
    return { path, branch, baseCommit }
  }

  finalize(input: {
    repositoryPath: string
    remoteName: string | undefined
    attemptId: string
    worktree: AttemptWorktree
  }): FinalizedAttemptWorktree {
    const changed = Boolean(this.git.run(input.worktree.path, ['status', '--porcelain']))
    if (changed) {
      this.git.run(input.worktree.path, ['add', '--all'])
    }
    this.git.run(input.worktree.path, [
      '-c',
      'user.name=MAM Attempt Scheduler',
      '-c',
      'user.email=mam-attempt@example.invalid',
      'commit',
      '--allow-empty',
      '--no-verify',
      '-m',
      `mam: submit ${input.attemptId}`
    ])
    const submittedCommit = this.git.run(input.worktree.path, [
      'rev-parse',
      '--verify',
      'HEAD^{commit}'
    ])
    if (input.remoteName) {
      this.git.run(input.worktree.path, [
        'push',
        input.remoteName,
        `HEAD:refs/heads/${input.worktree.branch}`
      ])
    }
    const cleaned = this.git.succeeds(input.repositoryPath, [
      'worktree',
      'remove',
      '--force',
      input.worktree.path
    ])
    return {
      ...input.worktree,
      submittedCommit,
      changed,
      ...(cleaned ? {} : { cleanupWarning: 'Attempt worktree cleanup failed' })
    }
  }

  abandon(repositoryPath: string, worktree: AttemptWorktree): boolean {
    return this.git.succeeds(repositoryPath, ['worktree', 'remove', '--force', worktree.path])
  }

  private resolveBaseCommit(
    repositoryPath: string,
    remoteName: string | undefined,
    baseRef: string
  ): string {
    const revision = `${baseRef}^{commit}`
    if (this.git.succeeds(repositoryPath, ['rev-parse', '--verify', revision])) {
      return this.git.run(repositoryPath, ['rev-parse', '--verify', revision])
    }
    if (
      baseRef === 'HEAD' &&
      this.git.succeeds(repositoryPath, ['symbolic-ref', '--quiet', 'HEAD'])
    ) {
      return this.initializeEmptyProject(repositoryPath, remoteName)
    }
    if (!remoteName) {
      throw new AttemptWorktreeError(
        'attempt_base_unavailable',
        `Attempt base ref ${baseRef} is unavailable in the local repository`
      )
    }
    this.git.run(repositoryPath, [
      'fetch',
      '--no-tags',
      remoteName,
      `+refs/heads/mam/attempt/*:refs/remotes/${remoteName}/mam/attempt/*`
    ])
    return this.git.run(repositoryPath, ['rev-parse', '--verify', revision])
  }

  private initializeEmptyProject(repositoryPath: string, remoteName: string | undefined): string {
    if (this.git.run(repositoryPath, ['status', '--porcelain'])) {
      throw new AttemptWorktreeError(
        'project_initial_commit_required',
        'Commit or remove project files before starting the first Attempt'
      )
    }
    const branch = this.git.run(repositoryPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
    const branchRef = `refs/heads/${branch}`
    this.git.run(repositoryPath, ['check-ref-format', branchRef])
    if (remoteName && this.remoteBranchCommit(repositoryPath, remoteName, branchRef)) {
      throw new AttemptWorktreeError(
        'project_remote_branch_requires_checkout',
        `Remote branch ${remoteName}/${branch} already exists; check it out before starting an Attempt`
      )
    }
    let commit: string
    try {
      this.git.run(repositoryPath, [
        '-c',
        'user.name=Multi-Agent Max',
        '-c',
        'user.email=multi-agent-max@localhost',
        'commit',
        '--allow-empty',
        '--only',
        '--no-verify',
        '-m',
        'mam: initialize empty project'
      ])
      commit = this.git.run(repositoryPath, ['rev-parse', '--verify', 'HEAD^{commit}'])
    } catch (error) {
      throw new AttemptWorktreeError('project_initial_commit_failed', String(error))
    }
    if (!remoteName) return commit
    try {
      this.git.run(repositoryPath, ['push', '-u', remoteName, `HEAD:${branchRef}`])
      return commit
    } catch (error) {
      if (this.remoteBranchCommit(repositoryPath, remoteName, branchRef, true) === commit) {
        return commit
      }
      const rolledBack = this.git.succeeds(repositoryPath, ['update-ref', '-d', branchRef, commit])
      throw new AttemptWorktreeError(
        'project_initial_push_failed',
        `${String(error)}${rolledBack ? '' : '; local initialization rollback failed'}`
      )
    }
  }

  private remoteBranchCommit(
    repositoryPath: string,
    remoteName: string,
    branchRef: string,
    tolerateFailure = false
  ): string | undefined {
    try {
      return this.git
        .run(repositoryPath, ['ls-remote', '--heads', remoteName, branchRef])
        .split(/\s+/, 1)[0]
    } catch (error) {
      if (tolerateFailure) return undefined
      throw new AttemptWorktreeError('project_remote_unavailable', String(error))
    }
  }
}

function assertInput(input: {
  repositoryPath: string
  workspaceRoot: string
  remoteName: string | undefined
  baseRef: string
}): void {
  if (!isAbsolute(input.repositoryPath) || !isAbsolute(input.workspaceRoot)) {
    throw new Error('Repository and Attempt workspace paths must be absolute')
  }
  if (input.remoteName && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.remoteName)) {
    throw new Error('Git remote name is invalid')
  }
  if (!input.baseRef) throw new Error('Attempt base ref is required')
}

export function attemptBranchName(attemptId: string): string {
  return `mam/attempt/${createHash('sha256').update(attemptId).digest('hex').slice(0, 32)}`
}

function workspacePath(root: string, attemptId: string): string {
  const digest = createHash('sha256').update(attemptId).digest('hex').slice(0, 32)
  return join(root, `attempt-${digest}`)
}
