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

export class AttemptWorktreeManager {
  constructor(private readonly git: GitCommandClient = createGitCommandClient()) {}

  prepare(input: {
    repositoryPath: string
    workspaceRoot: string
    remoteName: string
    attemptId: string
    baseRef: string
  }): AttemptWorktree {
    assertInput(input)
    const path = workspacePath(input.workspaceRoot, input.attemptId)
    if (existsSync(path)) throw new Error('Attempt worktree path already exists')
    mkdirSync(input.workspaceRoot, { recursive: true })
    this.fetchAttemptBranchesIfNeeded(input.repositoryPath, input.remoteName, input.baseRef)
    const baseCommit = this.git.run(input.repositoryPath, [
      'rev-parse',
      '--verify',
      `${input.baseRef}^{commit}`
    ])
    const branch = attemptBranchName(input.attemptId)
    this.git.run(input.repositoryPath, ['check-ref-format', `refs/heads/${branch}`])
    this.git.run(input.repositoryPath, ['worktree', 'add', '-b', branch, path, baseCommit])
    return { path, branch, baseCommit }
  }

  finalize(input: {
    repositoryPath: string
    remoteName: string
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
    this.git.run(input.worktree.path, [
      'push',
      input.remoteName,
      `HEAD:refs/heads/${input.worktree.branch}`
    ])
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

  private fetchAttemptBranchesIfNeeded(
    repositoryPath: string,
    remoteName: string,
    baseRef: string
  ): void {
    if (this.git.succeeds(repositoryPath, ['rev-parse', '--verify', `${baseRef}^{commit}`])) return
    this.git.run(repositoryPath, [
      'fetch',
      '--no-tags',
      remoteName,
      `+refs/heads/mam/attempt/*:refs/remotes/${remoteName}/mam/attempt/*`
    ])
  }
}

function assertInput(input: {
  repositoryPath: string
  workspaceRoot: string
  remoteName: string
  baseRef: string
}): void {
  if (!isAbsolute(input.repositoryPath) || !isAbsolute(input.workspaceRoot)) {
    throw new Error('Repository and Attempt workspace paths must be absolute')
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.remoteName)) {
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
