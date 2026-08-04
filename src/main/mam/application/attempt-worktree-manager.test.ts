import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createGitCommandClient,
  GitCommandError,
  type GitCommandClient
} from '../state-store/git-command-client'
import { AttemptWorktreeManager } from './attempt-worktree-manager'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('AttemptWorktreeManager', () => {
  it('keeps an Attempt branch local when the repository has no remote', () => {
    const fixture = createLocalProject()
    const manager = new AttemptWorktreeManager()
    const prepared = manager.prepare({
      repositoryPath: fixture.project,
      workspaceRoot: fixture.worktrees,
      remoteName: undefined,
      attemptId: 'attempt.local',
      baseRef: 'HEAD'
    })
    writeFileSync(join(prepared.path, 'result.txt'), 'local result\n')

    const finalized = manager.finalize({
      repositoryPath: fixture.project,
      remoteName: undefined,
      attemptId: 'attempt.local',
      worktree: prepared
    })

    expect(finalized.submittedCommit).toMatch(/^[0-9a-f]{40}$/)
    expect(git(fixture.project, ['rev-parse', `refs/heads/${prepared.branch}`])).toBe(
      finalized.submittedCommit
    )
    expect(git(fixture.project, ['show', `${finalized.submittedCommit}:result.txt`])).toBe(
      'local result'
    )
  })

  it('initializes and pushes a clean empty project before creating the Attempt worktree', () => {
    const fixture = createEmptyProject('mam-attempt-empty-')
    const manager = new AttemptWorktreeManager()

    const prepared = manager.prepare({
      repositoryPath: fixture.project,
      workspaceRoot: fixture.worktrees,
      remoteName: 'origin',
      attemptId: 'attempt.empty',
      baseRef: 'HEAD'
    })

    expect(git(fixture.project, ['log', '-1', '--format=%s'])).toBe('mam: initialize empty project')
    expect(git(fixture.origin, ['rev-parse', 'refs/heads/main'])).toBe(prepared.baseCommit)
    expect(existsSync(prepared.path)).toBe(true)
    expect(manager.abandon(fixture.project, prepared)).toBe(true)
  })

  it('requires an explicit first commit when the unborn project contains files', () => {
    const fixture = createEmptyProject('mam-attempt-dirty-')
    writeFileSync(join(fixture.project, 'README.md'), '# pending\n')

    expect(() =>
      new AttemptWorktreeManager().prepare({
        repositoryPath: fixture.project,
        workspaceRoot: fixture.worktrees,
        remoteName: 'origin',
        attemptId: 'attempt.dirty',
        baseRef: 'HEAD'
      })
    ).toThrow(expect.objectContaining({ code: 'project_initial_commit_required' }))
    expect(() => git(fixture.project, ['rev-parse', '--verify', 'HEAD^{commit}'])).toThrow()
    expect(git(fixture.project, ['ls-remote', '--heads', 'origin', 'refs/heads/main'])).toBe('')
  })

  it('rolls back a failed initial push so the Attempt can be retried', () => {
    const fixture = createEmptyProject('mam-attempt-push-retry-')
    const delegate = createGitCommandClient()
    let rejectPush = true
    const gitClient: GitCommandClient = {
      ...delegate,
      run: (cwd, args) => {
        if (rejectPush && args[0] === 'push') {
          rejectPush = false
          throw new GitCommandError(args, 1, 'simulated initial push failure')
        }
        return delegate.run(cwd, args)
      }
    }
    const manager = new AttemptWorktreeManager(gitClient)
    const input = {
      repositoryPath: fixture.project,
      workspaceRoot: fixture.worktrees,
      remoteName: 'origin',
      attemptId: 'attempt.retry',
      baseRef: 'HEAD'
    }

    expect(() => manager.prepare(input)).toThrow(
      expect.objectContaining({ code: 'project_initial_push_failed' })
    )
    expect(() => git(fixture.project, ['rev-parse', '--verify', 'HEAD^{commit}'])).toThrow()

    const prepared = manager.prepare(input)
    expect(git(fixture.origin, ['rev-parse', 'refs/heads/main'])).toBe(prepared.baseCommit)
    expect(manager.abandon(fixture.project, prepared)).toBe(true)
  })
})

function createEmptyProject(prefix: string): {
  root: string
  origin: string
  project: string
  worktrees: string
} {
  const root = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(root)
  const origin = join(root, 'origin.git')
  const project = join(root, 'project')
  mkdirSync(project)
  git(root, ['init', '--bare', origin])
  git(project, ['init'])
  git(project, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  git(project, ['remote', 'add', 'origin', origin])
  return { root, origin, project, worktrees: join(root, 'worktrees') }
}

function createLocalProject(): { root: string; project: string; worktrees: string } {
  const root = mkdtempSync(join(tmpdir(), 'mam-attempt-local-'))
  temporaryDirectories.push(root)
  const project = join(root, 'project')
  mkdirSync(project)
  git(project, ['init'])
  git(project, ['config', 'user.name', 'MAM Attempt Test'])
  git(project, ['config', 'user.email', 'mam-attempt-test@example.invalid'])
  writeFileSync(join(project, 'README.md'), '# local\n')
  git(project, ['add', 'README.md'])
  git(project, ['commit', '-m', 'base'])
  return { root, project, worktrees: join(root, 'worktrees') }
}

function git(directory: string, args: readonly string[]): string {
  return execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {
    cwd: directory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}
