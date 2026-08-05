import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { MergeQueueEntry } from '../../../shared/mam/domain/merge-queue'
import { createGitCommandClient, type GitCommandClient } from '../state-store/git-command-client'
import {
  runValidationCommand,
  type ValidationCommandResult,
  type ValidationCommandRunner
} from './validation-command-runner'
import {
  prepareLocalIntegrationTarget,
  publishLocalIntegrationTarget,
  type LocalIntegrationTarget
} from './local-integration-target-publisher'

type MergeStage = 'preflight' | 'fetch' | 'worktree' | 'merge' | 'validation' | 'push'

export type IntegrationMergeResult =
  | Readonly<{
      status: 'merged'
      mergeCommit: string
      targetCommitBefore: string
      validations: readonly ValidationCommandResult[]
      cleanupWarning?: string
    }>
  | Readonly<{
      status: 'conflict'
      targetCommitBefore: string
      submittedCommit: string
      mergeBase: string
      conflictingPaths: readonly string[]
      cleanupWarning?: string
    }>
  | Readonly<{
      status: 'failed'
      stage: MergeStage
      reason: string
      validations: readonly ValidationCommandResult[]
      cleanupWarning?: string
    }>

export type IntegrationMergeInput = Readonly<{
  repositoryPath: string
  integrationRoot: string
  remoteName: string | undefined
  entry: MergeQueueEntry
  validationCommands: readonly string[]
}>

export class IntegrationWorktreeMergeExecutor {
  constructor(
    private readonly git: GitCommandClient = createGitCommandClient(),
    private readonly runValidation: ValidationCommandRunner = runValidationCommand
  ) {}

  execute(input: IntegrationMergeInput): IntegrationMergeResult {
    let stage: MergeStage = 'preflight'
    let worktreeAdded = false
    let targetCommitBefore = ''
    let localTarget: LocalIntegrationTarget | undefined
    const validations: ValidationCommandResult[] = []
    const worktreePath = join(input.integrationRoot, worktreeName(input.entry.id))
    let outcome: IntegrationMergeResult
    try {
      assertInput(input, worktreePath)
      mkdirSync(input.integrationRoot, { recursive: true })
      stage = 'fetch'
      this.git.run(input.repositoryPath, [
        'check-ref-format',
        `refs/heads/${input.entry.targetBranch}`
      ])
      this.git.run(input.repositoryPath, [
        'check-ref-format',
        `refs/heads/${input.entry.sourceBranch}`
      ])
      if (input.remoteName) {
        this.git.run(input.repositoryPath, [
          'fetch',
          '--no-tags',
          input.remoteName,
          `+refs/heads/${input.entry.sourceBranch}:refs/remotes/${input.remoteName}/${input.entry.sourceBranch}`
        ])
        for (const branch of targetBaseBranches(input.entry.targetBranch)) {
          this.git.succeeds(input.repositoryPath, [
            'fetch',
            '--no-tags',
            input.remoteName,
            `+refs/heads/${branch}:refs/remotes/${input.remoteName}/${branch}`
          ])
        }
      }
      const targetRef = resolveTargetRef(this.git, input)
      const sourceRef = branchRef(input.remoteName, input.entry.sourceBranch)
      targetCommitBefore = this.git.run(input.repositoryPath, [
        'rev-parse',
        '--verify',
        `${targetRef}^{commit}`
      ])
      if (!input.remoteName && targetRef !== branchRef(undefined, input.entry.targetBranch)) {
        this.git.run(input.repositoryPath, [
          'update-ref',
          `refs/heads/${input.entry.targetBranch}`,
          targetCommitBefore
        ])
      }
      stage = 'preflight'
      if (!input.remoteName) {
        localTarget = prepareLocalIntegrationTarget({
          git: this.git,
          repositoryPath: input.repositoryPath,
          targetBranch: input.entry.targetBranch,
          targetCommitBefore
        })
      }
      const fetchedSourceCommit = this.git.run(input.repositoryPath, [
        'rev-parse',
        '--verify',
        `${sourceRef}^{commit}`
      ])
      this.git.run(input.repositoryPath, [
        'merge-base',
        '--is-ancestor',
        input.entry.submittedCommit,
        fetchedSourceCommit
      ])
      stage = 'worktree'
      this.git.run(input.repositoryPath, [
        'worktree',
        'add',
        '--detach',
        worktreePath,
        targetCommitBefore
      ])
      worktreeAdded = true
      stage = 'merge'
      const conflict = this.merge(worktreePath, input.entry, targetCommitBefore)
      if (conflict) {
        outcome = conflict
      } else {
        stage = 'validation'
        for (const command of input.validationCommands) {
          const result = this.runValidation(command, worktreePath)
          validations.push(result)
          if (result.exitCode !== 0) {
            throw new Error(`Validation failed: ${command}`)
          }
        }
        const mergeCommit = this.git.run(worktreePath, ['rev-parse', '--verify', 'HEAD^{commit}'])
        stage = 'push'
        if (input.remoteName) {
          this.git.run(worktreePath, [
            'push',
            input.remoteName,
            `HEAD:refs/heads/${input.entry.targetBranch}`
          ])
        } else {
          if (!localTarget) throw new Error('Local integration target was not prepared')
          publishLocalIntegrationTarget({
            git: this.git,
            repositoryPath: input.repositoryPath,
            target: localTarget,
            mergeCommit,
            targetCommitBefore
          })
        }
        outcome = { status: 'merged', mergeCommit, targetCommitBefore, validations }
      }
    } catch (error) {
      outcome = { status: 'failed', stage, reason: errorMessage(error), validations }
    }
    if (!worktreeAdded) return outcome
    const cleaned = this.git.succeeds(input.repositoryPath, [
      'worktree',
      'remove',
      '--force',
      worktreePath
    ])
    return cleaned ? outcome : { ...outcome, cleanupWarning: 'Integration worktree cleanup failed' }
  }

  private merge(
    worktreePath: string,
    entry: MergeQueueEntry,
    targetCommitBefore: string
  ): Extract<IntegrationMergeResult, { status: 'conflict' }> | undefined {
    const args =
      entry.strategy === 'ff_only'
        ? ['merge', '--ff-only', entry.submittedCommit]
        : [
            '-c',
            'user.name=MAM Merge Scheduler',
            '-c',
            'user.email=mam-merge@example.invalid',
            'merge',
            '--no-ff',
            '--no-edit',
            entry.submittedCommit
          ]
    try {
      this.git.run(worktreePath, args)
      return undefined
    } catch (error) {
      const paths = nulSeparated(
        this.git.run(worktreePath, ['diff', '--name-only', '--diff-filter=U', '-z'])
      )
      if (paths.length === 0) throw error
      const mergeBase = this.git.run(worktreePath, [
        'merge-base',
        targetCommitBefore,
        entry.submittedCommit
      ])
      this.git.succeeds(worktreePath, ['merge', '--abort'])
      return {
        status: 'conflict',
        targetCommitBefore,
        submittedCommit: entry.submittedCommit,
        mergeBase,
        conflictingPaths: paths
      }
    }
  }
}

function assertInput(input: IntegrationMergeInput, worktreePath: string): void {
  if (!isAbsolute(input.repositoryPath) || !isAbsolute(input.integrationRoot)) {
    throw new Error('Repository and integration worktree paths must be absolute')
  }
  if (input.entry.status !== 'merging') throw new Error('Merge Queue entry is not active')
  if (!/^[0-9a-f]{7,64}$/.test(input.entry.submittedCommit)) {
    throw new Error('Submitted commit must be a hexadecimal object ID')
  }
  if (input.remoteName && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.remoteName)) {
    throw new Error('Git remote name is invalid')
  }
  if (existsSync(worktreePath)) throw new Error('Integration worktree path already exists')
  const expected = Object.keys(input.entry.validationEvidence).sort()
  const actual = [...input.validationCommands].sort()
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error('Validation commands do not match Merge Queue evidence')
  }
}

function branchRef(remoteName: string | undefined, branch: string): string {
  return remoteName ? `refs/remotes/${remoteName}/${branch}` : `refs/heads/${branch}`
}

function resolveTargetRef(git: GitCommandClient, input: IntegrationMergeInput): string {
  const candidates = [
    ...targetBaseBranches(input.entry.targetBranch).map((branch) =>
      branchRef(input.remoteName, branch)
    ),
    ...targetBaseBranches(input.entry.targetBranch).map((branch) => branchRef(undefined, branch)),
    'HEAD'
  ]
  const target = [...new Set(candidates)].find((candidate) =>
    git.succeeds(input.repositoryPath, ['rev-parse', '--verify', `${candidate}^{commit}`])
  )
  if (!target) throw new Error(`No base commit is available for ${input.entry.targetBranch}`)
  return target
}

function targetBaseBranches(targetBranch: string): readonly string[] {
  if (targetBranch === 'develop') return ['develop', 'main', 'master']
  if (targetBranch === 'main') return ['main', 'develop', 'master']
  return [targetBranch, 'develop', 'main', 'master']
}

function worktreeName(entryId: string): string {
  return `merge-${createHash('sha256').update(entryId).digest('hex').slice(0, 24)}`
}

function nulSeparated(value: string): string[] {
  return value.split('\0').filter(Boolean).sort()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
