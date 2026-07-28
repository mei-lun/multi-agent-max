import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { MergeQueueEntry } from '../../../shared/mam/domain/merge-queue'
import { IntegrationWorktreeMergeExecutor } from './integration-worktree-merge-executor'

const hash = 'a'.repeat(64)
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('IntegrationWorktreeMergeExecutor with Git', () => {
  it('fetches, merges, validates, and pushes only the pinned task commit', () => {
    const fixture = repositoryFixture(false)
    const integrationRoot = join(fixture.root, 'integration')
    const result = new IntegrationWorktreeMergeExecutor().execute({
      repositoryPath: fixture.repository,
      integrationRoot,
      remoteName: 'origin',
      entry: queueEntry(fixture.sourceCommit, 'tasks/feature', 'git diff --check HEAD^ HEAD'),
      validationCommands: ['git diff --check HEAD^ HEAD']
    })

    expect(result).toMatchObject({ status: 'merged', targetCommitBefore: fixture.targetCommit })
    if (result.status !== 'merged') throw new Error(JSON.stringify(result))
    git(fixture.repository, ['fetch', 'origin', 'develop'])
    expect(git(fixture.repository, ['rev-parse', 'origin/develop'])).toBe(result.mergeCommit)
    expect(git(fixture.repository, ['show', `${result.mergeCommit}:feature.txt`])).toBe('feature')
    expect(
      git(fixture.repository, ['rev-list', '--parents', '-n', '1', result.mergeCommit]).split(' ')
    ).toHaveLength(3)
    expect(readdirSync(integrationRoot)).toEqual([])
  })

  it('returns conflict lineage without changing the remote target branch', () => {
    const fixture = repositoryFixture(true)
    const integrationRoot = join(fixture.root, 'integration')
    const result = new IntegrationWorktreeMergeExecutor().execute({
      repositoryPath: fixture.repository,
      integrationRoot,
      remoteName: 'origin',
      entry: queueEntry(fixture.sourceCommit, 'tasks/feature'),
      validationCommands: []
    })

    expect(result).toMatchObject({
      status: 'conflict',
      targetCommitBefore: fixture.targetCommit,
      submittedCommit: fixture.sourceCommit,
      conflictingPaths: ['shared.txt']
    })
    git(fixture.repository, ['fetch', 'origin', 'develop'])
    expect(git(fixture.repository, ['rev-parse', 'origin/develop'])).toBe(fixture.targetCommit)
    expect(readdirSync(integrationRoot)).toEqual([])
  })

  it('does not push when a post-merge validation fails', () => {
    const fixture = repositoryFixture(false)
    const result = new IntegrationWorktreeMergeExecutor().execute({
      repositoryPath: fixture.repository,
      integrationRoot: join(fixture.root, 'integration'),
      remoteName: 'origin',
      entry: queueEntry(fixture.sourceCommit, 'tasks/feature', 'git diff --exit-code HEAD HEAD^'),
      validationCommands: ['git diff --exit-code HEAD HEAD^']
    })

    expect(result).toMatchObject({ status: 'failed', stage: 'validation' })
    git(fixture.repository, ['fetch', 'origin', 'develop'])
    expect(git(fixture.repository, ['rev-parse', 'origin/develop'])).toBe(fixture.targetCommit)
  })
})

function repositoryFixture(withConflict: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'mam-integration-merge-'))
  temporaryDirectories.push(root)
  const remote = join(root, 'remote.git')
  const repository = join(root, 'repository')
  mkdirSync(remote)
  git(remote, ['init', '--bare'])
  git(root, ['clone', remote, repository])
  configureIdentity(repository)
  writeFileSync(join(repository, 'shared.txt'), 'base\n')
  git(repository, ['add', '.'])
  git(repository, ['commit', '-m', 'base'])
  git(repository, ['branch', '-M', 'develop'])
  git(repository, ['push', '-u', 'origin', 'develop'])
  const baseCommit = git(repository, ['rev-parse', 'HEAD'])

  git(repository, ['switch', '-c', 'tasks/feature'])
  if (withConflict) writeFileSync(join(repository, 'shared.txt'), 'source\n')
  else writeFileSync(join(repository, 'feature.txt'), 'feature\n')
  git(repository, ['add', '.'])
  git(repository, ['commit', '-m', 'feature'])
  const sourceCommit = git(repository, ['rev-parse', 'HEAD'])
  git(repository, ['push', '-u', 'origin', 'tasks/feature'])

  git(repository, ['switch', 'develop'])
  if (withConflict) {
    writeFileSync(join(repository, 'shared.txt'), 'target\n')
    git(repository, ['commit', '-am', 'target change'])
    git(repository, ['push', 'origin', 'develop'])
  }
  const targetCommit = git(repository, ['rev-parse', 'HEAD'])
  return { root, repository, baseCommit, sourceCommit, targetCommit }
}

function queueEntry(
  submittedCommit: string,
  sourceBranch: string,
  validationCommand?: string
): MergeQueueEntry {
  return {
    schemaVersion: '1.0.0',
    id: 'merge-entry.feature',
    workflowRunId: 'run.merge',
    mergeNodeId: 'merge',
    taskId: 'task.feature',
    attemptId: 'attempt.feature',
    targetBranch: 'develop',
    sourceBranch,
    submittedCommit,
    resultHash: hash,
    mergeReadyAt: '2026-07-28T18:00:00Z',
    readyRevisionHash: hash,
    reviewDecisionIds: ['review.feature'],
    validationEvidence: validationCommand ? { [validationCommand]: hash } : {},
    strategy: 'no_ff',
    conflictPolicy: 'coordinator_attempt',
    status: 'merging',
    claimedAt: '2026-07-28T18:01:00Z'
  }
}

function configureIdentity(directory: string): void {
  git(directory, ['config', 'user.name', 'MAM Merge Test'])
  git(directory, ['config', 'user.email', 'mam-merge-test@example.invalid'])
}

function git(directory: string, args: readonly string[]): string {
  return execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {
    cwd: directory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}
