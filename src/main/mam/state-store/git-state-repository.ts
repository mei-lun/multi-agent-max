import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { isKernelEventBatch, type KernelEventBatch } from '../scheduler/kernel'
import type { EffectiveRoleConfigSnapshot } from '../../../shared/mam/domain/role'
import type { WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'
import {
  AppendOnlyEventStore,
  AppendOnlyEventStoreError,
  type AppendOnlyResult
} from './append-only-event-store'
import {
  createGitCommandClient,
  GitCommandError,
  type GitCommandClient
} from './git-command-client'
import { replayWorkflowRun, type WorkflowRunProjection } from './git-event-projection'
import { GitEffectiveConfigStore, GitEffectiveConfigStoreError } from './git-effective-config-store'
import { GitRunBundleStore, GitRunBundleStoreError } from './git-run-bundle-store'
import {
  writeSystemArtifacts,
  readSystemArtifact,
  GitSystemArtifactWriterError,
  type GitSystemArtifactWrite
} from './git-system-artifact-writer'

export type GitStateRepositoryOptions = Readonly<{
  remote?: string
  branch?: string
  gitClient?: GitCommandClient
}>

export type GitStateAppendInput = Readonly<{
  workflowRunId: string
  batch: KernelEventBatch
  expectedRevision: string
  expectedParentCommit: string
  effectiveConfigSnapshot?: EffectiveRoleConfigSnapshot
  runBundle?: WorkflowRunBundle
  systemArtifactWrites?: readonly GitSystemArtifactWrite[]
  message?: string
}>

export type { GitSystemArtifactWrite } from './git-system-artifact-writer'

export type GitStateAppendResult = AppendOnlyResult & Readonly<{ commit: string }>

export class GitStateRepositoryError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'GitStateRepositoryError'
  }
}

export class GitStateRepository {
  readonly events: AppendOnlyEventStore
  readonly effectiveConfigs: GitEffectiveConfigStore
  readonly runBundles: GitRunBundleStore
  readonly stateDirectory: string
  readonly remote: string
  readonly branch: string
  readonly projectDirectory: string
  private readonly gitClient: GitCommandClient

  private constructor(
    projectDirectory: string,
    stateDirectory: string,
    remote: string,
    branch: string,
    gitClient: GitCommandClient
  ) {
    this.projectDirectory = resolve(projectDirectory)
    this.stateDirectory = resolve(stateDirectory)
    this.remote = remote
    this.branch = branch
    this.gitClient = gitClient
    this.events = new AppendOnlyEventStore(join(this.stateDirectory, '.workflow'))
    this.effectiveConfigs = new GitEffectiveConfigStore(join(this.stateDirectory, '.workflow'))
    this.runBundles = new GitRunBundleStore(join(this.stateDirectory, '.workflow'))
  }

  static attach(
    projectDirectory: string,
    stateDirectory?: string,
    options: GitStateRepositoryOptions = {}
  ): GitStateRepository {
    const project = resolve(projectDirectory)
    const state = resolve(
      stateDirectory ?? join(dirname(project), `.${basename(project)}-mam-state`)
    )
    assertIndependentDirectory(project, state)
    const git = options.gitClient ?? createGitCommandClient()
    const remote = options.remote ?? 'origin'
    const branch = options.branch ?? 'mam-state'
    if (!git.succeeds(project, ['rev-parse', '--is-inside-work-tree'])) {
      throw new GitStateRepositoryError('not_git_repository', 'project is not a Git worktree')
    }
    if (!git.succeeds(state, ['rev-parse', '--is-inside-work-tree'])) {
      attachWorktree(project, state, remote, branch, git)
    }
    const repository = new GitStateRepository(project, state, remote, branch, git)
    // Reattaching after a crash must not treat a committed-but-unpushed event as authoritative.
    repository.alignToRemote()
    return repository
  }

  currentCommit(): string {
    return this.git(['rev-parse', 'HEAD'])
  }

  readProjectBlob(commit: string, projectRelativePath: string): string {
    return this.gitClient.runRaw(this.projectDirectory, [
      'cat-file',
      'blob',
      `${commit}:${projectRelativePath}`
    ])
  }

  readStateArtifact(storageRef: string): Buffer {
    return readSystemArtifact(this.stateDirectory, storageRef)
  }

  rebuild(workflowRunId: string): WorkflowRunProjection {
    this.discardUncommittedState()
    return replayWorkflowRun(workflowRunId, this.events.listEvents(workflowRunId))
  }

  listWorkflowRunIds(): readonly string[] {
    return this.events.listWorkflowRunIds()
  }

  loadEffectiveConfigSnapshot(
    workflowRunId: string,
    attemptId: string
  ): EffectiveRoleConfigSnapshot | undefined {
    try {
      return this.effectiveConfigs.load(workflowRunId, attemptId)
    } catch (error) {
      if (error instanceof GitEffectiveConfigStoreError) {
        throw new GitStateRepositoryError(error.code, error.message)
      }
      throw error
    }
  }

  loadRunBundle(workflowRunId: string): WorkflowRunBundle | undefined {
    try {
      return this.runBundles.load(workflowRunId)
    } catch (error) {
      if (error instanceof GitRunBundleStoreError) {
        throw new GitStateRepositoryError(error.code, error.message)
      }
      throw error
    }
  }

  appendAndCommit(input: GitStateAppendInput): GitStateAppendResult {
    if (!isKernelEventBatch(input.batch)) {
      throw new GitStateRepositoryError('scheduler_authority_required', 'expected a Kernel batch')
    }
    if (this.currentCommit() !== input.expectedParentCommit) {
      throw new GitStateRepositoryError('parent_commit_mismatch', 'state commit is stale')
    }
    try {
      this.runBundles.validateAndWrite({
        workflowRunId: input.workflowRunId,
        batch: input.batch,
        ...(input.runBundle && { bundle: input.runBundle })
      })
    } catch (error) {
      if (error instanceof GitRunBundleStoreError) {
        throw new GitStateRepositoryError(error.code, error.message)
      }
      throw error
    }
    try {
      this.effectiveConfigs.validateAndWrite({
        workflowRunId: input.workflowRunId,
        batch: input.batch,
        ...(input.effectiveConfigSnapshot && { snapshot: input.effectiveConfigSnapshot })
      })
    } catch (error) {
      if (error instanceof GitEffectiveConfigStoreError) {
        throw new GitStateRepositoryError(error.code, error.message)
      }
      throw error
    }
    let appended: AppendOnlyResult
    try {
      appended = this.events.append(input.workflowRunId, input.batch, input.expectedRevision)
    } catch (error) {
      if (error instanceof AppendOnlyEventStoreError) {
        throw new GitStateRepositoryError(error.code, error.message)
      }
      throw error
    }
    if (appended.appendedEventIds.length === 0) {
      return { ...appended, commit: this.currentCommit() }
    }
    try {
      writeSystemArtifacts({
        stateDirectory: this.stateDirectory,
        workflowRunId: input.workflowRunId,
        writes: input.systemArtifactWrites ?? []
      })
    } catch (error) {
      if (error instanceof GitSystemArtifactWriterError) {
        throw new GitStateRepositoryError(error.code, error.message)
      }
      throw error
    }
    const runPath = `.workflow/runs/${input.workflowRunId}`
    this.git(['add', '--', runPath])
    this.git([
      'commit',
      '--only',
      '--no-verify',
      '-m',
      input.message ?? `mam: append ${appended.appendedEventIds.join(', ')}`,
      '--',
      runPath
    ])
    return { ...appended, commit: this.currentCommit() }
  }

  appendCommitAndPush(input: GitStateAppendInput): GitStateAppendResult {
    const result = this.appendAndCommit(input)
    if (result.appendedEventIds.length === 0) return result
    try {
      this.git(['push', this.remote, `HEAD:refs/heads/${this.branch}`])
    } catch (error) {
      if (isNonFastForward(error)) {
        throw new GitStateRepositoryError('remote_non_fast_forward', String(error))
      }
      throw new GitStateRepositoryError('remote_push_failed', String(error))
    }
    return result
  }

  alignToRemote(): void {
    this.fetchStateBranch()
    try {
      this.git(['checkout', '-B', this.branch, this.remoteRef()])
    } catch (error) {
      throw new GitStateRepositoryError('remote_alignment_failed', String(error))
    }
  }

  private discardUncommittedState(): void {
    if (!this.git(['status', '--porcelain', '--', '.workflow'])) return
    this.git(['checkout', '--', '.workflow'])
    this.git(['clean', '-f', '-d', '--', '.workflow'])
  }

  private fetchStateBranch(): void {
    this.git([
      'fetch',
      this.remote,
      `refs/heads/${this.branch}:refs/remotes/${this.remote}/${this.branch}`
    ])
  }

  private remoteRef(): string {
    return `refs/remotes/${this.remote}/${this.branch}`
  }

  private git(args: readonly string[]): string {
    try {
      return this.gitClient.run(this.stateDirectory, args)
    } catch (error) {
      if (error instanceof GitStateRepositoryError) throw error
      throw new GitStateRepositoryError('git_command_failed', String(error))
    }
  }
}

function attachWorktree(
  project: string,
  state: string,
  remote: string,
  branch: string,
  git: GitCommandClient
): void {
  mkdirSync(dirname(state), { recursive: true })
  const fetchArgs = [
    'fetch',
    remote,
    `refs/heads/${branch}:refs/remotes/${remote}/${branch}`
  ] as const
  const hasRemoteBranch = git.succeeds(project, fetchArgs)
  if (hasRemoteBranch) {
    git.run(project, ['worktree', 'add', '-B', branch, state, `refs/remotes/${remote}/${branch}`])
    return
  }
  git.run(project, ['worktree', 'add', '--detach', state, 'HEAD'])
  git.run(state, ['checkout', '--orphan', branch])
  git.run(state, ['rm', '-r', '-f', '--ignore-unmatch', '.'])
  mkdirSync(join(state, '.workflow'), { recursive: true })
  writeFileSync(join(state, '.workflow', '.gitkeep'), '')
  git.run(state, ['add', '.workflow/.gitkeep'])
  git.run(state, ['commit', '--no-verify', '-m', 'mam: initialize state branch'])
  git.run(state, ['push', '-u', remote, `HEAD:refs/heads/${branch}`])
}

function assertIndependentDirectory(project: string, state: string): void {
  const relation = relative(project, state)
  if (state === project || (!relation.startsWith('..') && !isAbsolute(relation))) {
    throw new GitStateRepositoryError(
      'state_worktree_not_independent',
      'state worktree must be outside the project worktree'
    )
  }
}

function isNonFastForward(error: unknown): boolean {
  const detail =
    error instanceof GitCommandError ? `${error.stderr}\n${error.message}` : String(error)
  return /non-fast-forward|fetch first|\[rejected\]/i.test(detail)
}
