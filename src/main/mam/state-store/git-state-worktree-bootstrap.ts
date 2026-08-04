import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import type { GitCommandClient } from './git-command-client'
import { GitStateRepositoryError } from './git-state-repository-error'

const MAM_GIT_IDENTITY = [
  '-c',
  'user.name=Multi-Agent Max',
  '-c',
  'user.email=multi-agent-max@localhost'
] as const

export function assertGitStateRemoteConfigured(
  project: string,
  remote: string | undefined,
  git: GitCommandClient
): void {
  if (!remote) return
  if (git.succeeds(project, ['remote', 'get-url', remote])) return
  throw new GitStateRepositoryError(
    'git_remote_required',
    `Git remote "${remote}" is required before selecting this project`
  )
}

/** Returns the first configured Git remote, preferring the conventional `origin`. */
export function detectGitRemote(project: string, git: GitCommandClient): string | undefined {
  const remotes = git
    .run(project, ['remote'])
    .split(/\r?\n/)
    .map((remote) => remote.trim())
    .filter(Boolean)
  return remotes.find((remote) => remote === 'origin') ?? remotes[0]
}

export function assertIndependentGitStateDirectory(project: string, state: string): void {
  const relation = relative(project, state)
  if (state === project || (!relation.startsWith('..') && !isAbsolute(relation))) {
    throw new GitStateRepositoryError(
      'state_worktree_not_independent',
      'state worktree must be outside the project worktree'
    )
  }
}

export function attachGitStateWorktree(input: {
  project: string
  state: string
  remote?: string
  branch: string
  git: GitCommandClient
}): void {
  const { project, state, remote, branch, git } = input
  mkdirSync(dirname(state), { recursive: true })
  if (!remote) {
    attachLocalStateWorktree({ project, state, branch, git })
    return
  }
  const remoteRef = `refs/heads/${branch}`
  if (remoteBranchExists(project, remote, remoteRef, git)) {
    git.run(project, ['fetch', remote, `${remoteRef}:refs/remotes/${remote}/${branch}`])
    git.run(project, ['worktree', 'add', '-B', branch, state, `refs/remotes/${remote}/${branch}`])
    return
  }
  const localRef = `refs/heads/${branch}`
  const branchExisted = git.succeeds(project, ['show-ref', '--verify', '--quiet', localRef])
  git.run(project, ['worktree', 'add', '--detach', state, worktreeBase(project, git)])
  let branchCreated = false
  try {
    git.run(state, ['checkout', '--orphan', branch])
    branchCreated = true
    git.run(state, ['rm', '-r', '-f', '--ignore-unmatch', '.'])
    mkdirSync(join(state, '.workflow'), { recursive: true })
    writeFileSync(join(state, '.workflow', '.gitkeep'), '')
    git.run(state, ['add', '.workflow/.gitkeep'])
    git.run(state, [
      ...MAM_GIT_IDENTITY,
      'commit',
      '--no-verify',
      '-m',
      'mam: initialize state branch'
    ])
    git.run(state, ['push', '-u', remote, `HEAD:refs/heads/${branch}`])
  } catch (error) {
    const worktreeRemoved = git.succeeds(project, ['worktree', 'remove', '--force', state])
    const branchRemoved =
      !branchCreated || branchExisted || git.succeeds(project, ['branch', '-D', branch])
    const cleanup = worktreeRemoved && branchRemoved ? '' : '; bootstrap cleanup was incomplete'
    throw new GitStateRepositoryError(
      'state_branch_initialization_failed',
      `${String(error)}${cleanup}`
    )
  }
}

function attachLocalStateWorktree(input: {
  project: string
  state: string
  branch: string
  git: GitCommandClient
}): void {
  const { project, state, branch, git } = input
  const localRef = `refs/heads/${branch}`
  if (git.succeeds(project, ['show-ref', '--verify', '--quiet', localRef])) {
    // Keep the shared branch available to another local process; detached worktrees
    // publish back to this ref with a compare-and-swap after committing state.
    git.run(project, ['worktree', 'add', '--detach', state, branch])
    return
  }

  git.run(project, ['worktree', 'add', '--detach', state, worktreeBase(project, git)])
  let branchCreated = false
  try {
    git.run(state, ['checkout', '--orphan', branch])
    branchCreated = true
    git.run(state, ['rm', '-r', '-f', '--ignore-unmatch', '.'])
    mkdirSync(join(state, '.workflow'), { recursive: true })
    writeFileSync(join(state, '.workflow', '.gitkeep'), '')
    git.run(state, ['add', '.workflow/.gitkeep'])
    git.run(state, [
      ...MAM_GIT_IDENTITY,
      'commit',
      '--no-verify',
      '-m',
      'mam: initialize local state branch'
    ])
  } catch (error) {
    const worktreeRemoved = git.succeeds(project, ['worktree', 'remove', '--force', state])
    const branchRemoved = !branchCreated || git.succeeds(project, ['branch', '-D', branch])
    const cleanup = worktreeRemoved && branchRemoved ? '' : '; bootstrap cleanup was incomplete'
    throw new GitStateRepositoryError(
      'state_branch_initialization_failed',
      `${String(error)}${cleanup}`
    )
  }
}

function remoteBranchExists(
  project: string,
  remote: string,
  remoteRef: string,
  git: GitCommandClient
): boolean {
  try {
    return Boolean(git.run(project, ['ls-remote', '--heads', remote, remoteRef]))
  } catch (error) {
    throw new GitStateRepositoryError('git_remote_unavailable', String(error))
  }
}

function worktreeBase(project: string, git: GitCommandClient): string {
  if (git.succeeds(project, ['rev-parse', '--verify', 'HEAD^{commit}'])) return 'HEAD'
  if (!git.succeeds(project, ['symbolic-ref', '--quiet', 'HEAD'])) {
    throw new GitStateRepositoryError(
      'project_head_invalid',
      'Project HEAD is invalid and cannot be used to initialize mam-state'
    )
  }
  return createEmptyWorktreeSeed(project, git)
}

function createEmptyWorktreeSeed(project: string, git: GitCommandClient): string {
  try {
    const emptyTree = git.run(project, ['hash-object', '-t', 'tree', '--stdin', '-w'])
    return git.run(project, [
      ...MAM_GIT_IDENTITY,
      'commit-tree',
      emptyTree,
      '-m',
      'mam: prepare state worktree'
    ])
  } catch (error) {
    throw new GitStateRepositoryError('state_worktree_seed_failed', String(error))
  }
}
