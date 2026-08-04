import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import type { EffectiveRoleConfigSnapshot } from '../../../shared/mam/domain/role'
import type { WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'
import type { WorkflowDefinition } from '../../../shared/mam/domain/workflow'
import { profileContentHash } from '../profiles/profile-content-hash'
import { buildAttemptResult } from '../artifacts/attempt-result-builder'
import {
  createWorkflowRunBundle,
  createWorkflowRunCommand
} from '../application/workflow-run-factory'
import { GitCommandConflictStore } from './git-command-conflict-store'
import { GitCommandRetryCoordinator } from './git-command-retry-coordinator'
import {
  createGitCommandClient,
  GitCommandError,
  type GitCommandClient
} from './git-command-client'
import { GitStateRepository } from './git-state-repository'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('GitStateRepository with real Git clones', () => {
  it('bootstraps mam-state while the project HEAD remains unborn', () => {
    const root = mkdtempSync(join(tmpdir(), 'mam-empty-project-'))
    temporaryDirectories.push(root)
    const origin = join(root, 'origin.git')
    const project = join(root, 'project')
    const state = join(root, 'state')
    mkdirSync(project)
    git(root, ['init', '--bare', origin])
    git(project, ['init'])
    const initialBranch = git(project, ['symbolic-ref', '--short', 'HEAD'])
    writeFileSync(join(project, 'staged.txt'), 'keep staged\n')
    git(project, ['add', 'staged.txt'])
    git(project, ['remote', 'add', 'origin', origin])

    const repository = GitStateRepository.attach(project, state)

    expect(repository.collaborationMode).toBe('distributed')
    expect(repository.remote).toBe('origin')
    expect(git(project, ['symbolic-ref', '--short', 'HEAD'])).toBe(initialBranch)
    expect(() => git(project, ['rev-parse', '--verify', 'HEAD^{commit}'])).toThrow()
    expect(git(project, ['status', '--short', '--', 'staged.txt'])).toBe('A  staged.txt')
    expect(git(state, ['branch', '--show-current'])).toBe('mam-state')
    expect(git(origin, ['show', 'refs/heads/mam-state:.workflow/.gitkeep'])).toBe('')
    expect(git(origin, ['rev-parse', 'refs/heads/mam-state'])).toBe(repository.currentCommit())
    expect(repository.listWorkflowRunIds()).toEqual([])
  })

  it('reattaches a second unborn project to the existing mam-state branch', () => {
    const root = mkdtempSync(join(tmpdir(), 'mam-empty-project-pair-'))
    temporaryDirectories.push(root)
    const origin = join(root, 'origin.git')
    const projectA = join(root, 'project-a')
    const projectB = join(root, 'project-b')
    mkdirSync(projectA)
    mkdirSync(projectB)
    git(root, ['init', '--bare', origin])
    for (const project of [projectA, projectB]) {
      git(project, ['init'])
      git(project, ['remote', 'add', 'origin', origin])
    }

    const repositoryA = GitStateRepository.attach(projectA, join(root, 'state-a'))
    const repositoryB = GitStateRepository.attach(projectB, join(root, 'state-b'))

    expect(repositoryB.currentCommit()).toBe(repositoryA.currentCommit())
    expect(git(origin, ['rev-list', '--count', 'refs/heads/mam-state'])).toBe('1')
    for (const project of [projectA, projectB]) {
      expect(() => git(project, ['rev-parse', '--verify', 'HEAD^{commit}'])).toThrow()
    }
  })

  it('keeps state local when an unborn project has no remote', () => {
    const root = mkdtempSync(join(tmpdir(), 'mam-empty-project-no-remote-'))
    temporaryDirectories.push(root)
    const project = join(root, 'project')
    const state = join(root, 'state')
    mkdirSync(project)
    git(project, ['init'])
    configureIdentity(project)
    const initialBranch = git(project, ['symbolic-ref', '--short', 'HEAD'])
    writeFileSync(join(project, 'staged.txt'), 'keep staged\n')
    git(project, ['add', 'staged.txt'])

    const repository = GitStateRepository.attach(project, state)
    const initialStateCommit = repository.currentCommit()
    initializeRun(new GitCommandRetryCoordinator(repository))

    expect(repository.collaborationMode).toBe('local')
    expect(repository.remote).toBeUndefined()
    expect(repository.currentCommit()).not.toBe(initialStateCommit)
    expect(repository.listWorkflowRunIds()).toEqual(['run.git'])
    expect(git(state, ['branch', '--show-current'])).toBe('mam-state')
    expect(git(project, ['symbolic-ref', '--short', 'HEAD'])).toBe(initialBranch)
    expect(() => git(project, ['rev-parse', '--verify', 'HEAD^{commit}'])).toThrow()
    expect(git(project, ['status', '--short', '--', 'staged.txt'])).toBe('A  staged.txt')

    const reattached = GitStateRepository.attach(project, state)
    expect(reattached.currentCommit()).toBe(repository.currentCommit())
    expect(reattached.rebuild('run.git').eventIds).toHaveLength(1)
  })

  it('allows separate local state worktrees to publish to one local branch', () => {
    const root = mkdtempSync(join(tmpdir(), 'mam-local-state-pair-'))
    temporaryDirectories.push(root)
    const project = join(root, 'project')
    mkdirSync(project)
    git(project, ['init'])
    configureIdentity(project)
    writeFileSync(join(project, 'README.md'), '# local pair\n')
    git(project, ['add', 'README.md'])
    git(project, ['commit', '-m', 'base'])

    const repositoryA = GitStateRepository.attach(project, join(root, 'state-a'))
    const coordinatorA = new GitCommandRetryCoordinator(repositoryA)
    const bundle = initializeRun(coordinatorA)
    const repositoryB = GitStateRepository.attach(project, join(root, 'state-b'))
    const coordinatorB = new GitCommandRetryCoordinator(repositoryB)

    const resultB = coordinatorB.executeAndPush({
      command: assignmentCommand('command.assign.local', taskId(bundle, 'task-a')),
      schedulerId: 'scheduler.local'
    })

    repositoryA.alignToRemote()
    expect(resultB.retryCount).toBe(0)
    expect(repositoryA.rebuild('run.git').stateHash).toBe(resultB.projection.stateHash)
  })

  it('retries a stale local state publication on the current local branch', () => {
    const root = mkdtempSync(join(tmpdir(), 'mam-local-state-retry-'))
    temporaryDirectories.push(root)
    const project = join(root, 'project')
    mkdirSync(project)
    git(project, ['init'])
    configureIdentity(project)
    writeFileSync(join(project, 'README.md'), '# local retry\n')
    git(project, ['add', 'README.md'])
    git(project, ['commit', '-m', 'base'])

    const repositoryA = GitStateRepository.attach(project, join(root, 'state-a'))
    const coordinatorA = new GitCommandRetryCoordinator(repositoryA)
    const bundle = initializeRun(coordinatorA)
    const repositoryB = GitStateRepository.attach(project, join(root, 'state-b'))
    const coordinatorB = new GitCommandRetryCoordinator(repositoryB)
    const preparedA = coordinatorA.prepare({
      command: assignmentCommand('command.assign.local.a', taskId(bundle, 'task-a')),
      schedulerId: 'scheduler.local'
    })
    const preparedB = coordinatorB.prepare({
      command: assignmentCommand('command.assign.local.b', taskId(bundle, 'task-b')),
      schedulerId: 'scheduler.local'
    })

    coordinatorA.publish(preparedA)
    const resultB = coordinatorB.publish(preparedB)

    expect(resultB.retryCount).toBe(1)
    expect(resultB.projection.tasks[taskId(bundle, 'task-a')]).toMatchObject({
      roleProfileId: 'role.developer'
    })
    expect(resultB.projection.tasks[taskId(bundle, 'task-b')]).toMatchObject({
      roleProfileId: 'role.developer'
    })
  })

  it('distinguishes an unavailable remote from a missing mam-state branch', () => {
    const root = mkdtempSync(join(tmpdir(), 'mam-empty-project-bad-remote-'))
    temporaryDirectories.push(root)
    const project = join(root, 'project')
    const state = join(root, 'state')
    mkdirSync(project)
    git(project, ['init'])
    git(project, ['remote', 'add', 'origin', join(root, 'missing-origin.git')])

    expect(() => GitStateRepository.attach(project, state)).toThrow(
      expect.objectContaining({ code: 'git_remote_unavailable' })
    )
    expect(existsSync(state)).toBe(false)
  })

  it('cleans a failed initial push so project selection can retry', () => {
    const root = mkdtempSync(join(tmpdir(), 'mam-empty-project-push-retry-'))
    temporaryDirectories.push(root)
    const origin = join(root, 'origin.git')
    const project = join(root, 'project')
    const state = join(root, 'state')
    mkdirSync(project)
    git(root, ['init', '--bare', origin])
    git(project, ['init'])
    git(project, ['remote', 'add', 'origin', origin])
    const delegate = createGitCommandClient()
    let rejectPush = true
    const gitClient: GitCommandClient = {
      ...delegate,
      run: (cwd, args) => {
        if (rejectPush && args[0] === 'push') {
          rejectPush = false
          throw new GitCommandError(args, 1, 'simulated push failure')
        }
        return delegate.run(cwd, args)
      }
    }

    expect(() => GitStateRepository.attach(project, state, { gitClient })).toThrow(
      expect.objectContaining({ code: 'state_branch_initialization_failed' })
    )
    expect(existsSync(state)).toBe(false)

    const repository = GitStateRepository.attach(project, state, { gitClient })
    expect(git(origin, ['rev-parse', 'refs/heads/mam-state'])).toBe(repository.currentCommit())
  })

  it('does not treat a damaged HEAD as an unborn branch', () => {
    const root = mkdtempSync(join(tmpdir(), 'mam-project-invalid-head-'))
    temporaryDirectories.push(root)
    const origin = join(root, 'origin.git')
    const project = join(root, 'project')
    const state = join(root, 'state')
    mkdirSync(project)
    git(root, ['init', '--bare', origin])
    git(project, ['init'])
    git(project, ['remote', 'add', 'origin', origin])
    writeFileSync(join(project, '.git', 'HEAD'), 'invalid-head\n')

    expect(() => GitStateRepository.attach(project, state)).toThrow(
      expect.objectContaining({ code: 'not_git_repository' })
    )
    expect(existsSync(state)).toBe(false)
  })

  it('re-executes a stale command and converges without changing either project branch', () => {
    const fixture = createGitFixture()
    const repositoryA = GitStateRepository.attach(fixture.cloneA, fixture.stateA)
    const repositoryB = GitStateRepository.attach(fixture.cloneB, fixture.stateB)
    const coordinatorA = new GitCommandRetryCoordinator(repositoryA)
    const coordinatorB = new GitCommandRetryCoordinator(repositoryB)
    const bundle = initializeRun(coordinatorA)
    const taskA = taskId(bundle, 'task-a')
    const taskB = taskId(bundle, 'task-b')

    expect(() =>
      coordinatorA.executeAndPush({
        command: assignmentCommand('command.assign.unknown', 'task.not-in-catalog'),
        schedulerId: 'scheduler.1'
      })
    ).toThrow(expect.objectContaining({ code: 'task_binding_mismatch' }))
    expect(() =>
      coordinatorA.executeAndPush({
        command: assignmentCommand('command.assign.bad-role', taskA, 'role.not-allowed'),
        schedulerId: 'scheduler.1'
      })
    ).toThrow(expect.objectContaining({ code: 'role_not_allowed' }))
    expect(() =>
      coordinatorA.executeAndPush({
        command: assignmentCommand('command.assign.bad-version', taskA, 'role.developer', 2),
        schedulerId: 'scheduler.1'
      })
    ).toThrow(expect.objectContaining({ code: 'role_not_in_run_catalog' }))

    const preparedB = coordinatorB.prepare({
      command: assignmentCommand('command.assign.b', taskB),
      schedulerId: 'scheduler.1'
    })
    expect(repositoryB.loadRunBundle('run.git')).toEqual(bundle)
    const resultA = coordinatorA.executeAndPush({
      command: assignmentCommand('command.assign.a', taskA),
      schedulerId: 'scheduler.1'
    })
    const staleParent = repositoryB.currentCommit()
    const resultB = coordinatorB.publish(preparedB)

    expect(resultB.retryCount).toBe(1)
    expect(resultB.commit).not.toBe(staleParent)
    expect(resultB.projection.tasks[taskA]).toMatchObject({ roleProfileId: 'role.developer' })
    expect(resultB.projection.tasks[taskB]).toMatchObject({ roleProfileId: 'role.developer' })

    repositoryA.alignToRemote()
    const projectionA = repositoryA.rebuild('run.git')
    const projectionB = repositoryB.rebuild('run.git')
    expect(projectionA.revision).toBe(projectionB.revision)
    expect(projectionA.stateHash).toBe(projectionB.stateHash)
    expect(projectionA.eventIds).toHaveLength(3)
    expect(resultA.retryCount).toBe(0)
    expect(repositoryB.events.listEvents('run.git')[2]?.parentRevision).toBe(resultA.revision)

    expect(git(fixture.cloneA, ['branch', '--show-current'])).toBe('main')
    expect(git(fixture.cloneB, ['branch', '--show-current'])).toBe('main')
    expect(git(fixture.cloneA, ['ls-tree', '-r', '--name-only', 'main'])).not.toContain('.workflow')
    const stateLog = git(fixture.stateB, ['log', '--format=%s', '--first-parent'])
    expect(stateLog).not.toMatch(/merge|rebase/i)
    expect(stateLog.match(/mam: append/g)).toHaveLength(3)

    const crashFile = join(
      fixture.stateB,
      '.workflow',
      'runs',
      'run.crash',
      'events',
      '0000000001.json'
    )
    mkdirSync(join(crashFile, '..'), { recursive: true })
    writeFileSync(crashFile, '{"partial":true}\n')
    expect(repositoryB.rebuild('run.crash').eventIds).toEqual([])
    expect(existsSync(crashFile)).toBe(false)

    const duplicate = coordinatorA.executeAndPush({
      command: assignmentCommand('command.assign.a', taskA),
      schedulerId: 'scheduler.1'
    })
    expect(duplicate.appendedEventIds).toEqual([])
    expect(duplicate.commit).toBe(resultB.commit)
  })

  it('persists and applies a user resolution when command regeneration becomes invalid', () => {
    const fixture = createGitFixture()
    const repositoryA = GitStateRepository.attach(fixture.cloneA, fixture.stateA)
    const repositoryB = GitStateRepository.attach(fixture.cloneB, fixture.stateB)
    const conflicts = new GitCommandConflictStore(
      join(fixture.cloneB, '.mam-local', 'conflicts.json')
    )
    const coordinatorA = new GitCommandRetryCoordinator(repositoryA)
    const coordinatorB = new GitCommandRetryCoordinator(repositoryB, undefined, conflicts)
    const bundle = initializeRun(coordinatorA)
    const sameTask = taskId(bundle, 'task-same')
    const preparedB = coordinatorB.prepare({
      command: assignmentCommand('command.assign.competing', sameTask),
      schedulerId: 'scheduler.1'
    })

    coordinatorA.executeAndPush({
      command: assignmentCommand('command.assign.winner', sameTask),
      schedulerId: 'scheduler.1'
    })
    expect(() => coordinatorB.publish(preparedB)).toThrow(
      expect.objectContaining({ conflictId: 'conflict.command.assign.competing' })
    )
    expect(conflicts.list('pending')).toHaveLength(1)

    const resolution = coordinatorB.resolveConflict(
      resolutionCommand('conflict.command.assign.competing'),
      'scheduler.1'
    )
    expect(resolution.appendedEventIds).toEqual(['command.resolve.competing:event:1'])
    expect(conflicts.list('pending')).toEqual([])
    expect(conflicts.list('consumed')).toHaveLength(1)

    repositoryA.alignToRemote()
    expect(
      repositoryA.rebuild('run.git').conflictResolutions['conflict.command.assign.competing']
    ).toMatchObject({
      resolution: 'accept_remote_state',
      userId: 'user.owner'
    })
  })

  it('retains concurrent Attempts and projects an advisory execution warning', () => {
    const fixture = createGitFixture()
    const repositoryA = GitStateRepository.attach(fixture.cloneA, fixture.stateA)
    const repositoryB = GitStateRepository.attach(fixture.cloneB, fixture.stateB)
    const coordinatorA = new GitCommandRetryCoordinator(repositoryA)
    const coordinatorB = new GitCommandRetryCoordinator(repositoryB)
    const bundle = initializeRun(coordinatorA)
    const sharedTask = taskId(bundle, 'task-shared')
    coordinatorA.executeAndPush({
      command: assignmentCommand('command.assign.shared', sharedTask),
      schedulerId: 'scheduler.1'
    })
    const preparedA = coordinatorA.prepare({
      command: announcementCommand('a', sharedTask),
      schedulerId: 'scheduler.1'
    })
    const preparedB = coordinatorB.prepare({
      command: announcementCommand('b', sharedTask),
      schedulerId: 'scheduler.1'
    })

    coordinatorA.publish(preparedA)
    const resultB = coordinatorB.publish(preparedB)
    expect(resultB.retryCount).toBe(1)
    expect(Object.keys(resultB.projection.attempts).sort()).toEqual(['attempt.a', 'attempt.b'])
    expect(resultB.projection.tasks[sharedTask]?.executionWarnings).toEqual([
      {
        attemptId: 'attempt.b',
        concurrentAttemptIds: ['attempt.a'],
        eventId: 'command.announce.b:event:1'
      }
    ])
  })

  it('commits the Effective Config atomically with attempt_started for another clone', () => {
    const fixture = createGitFixture()
    const repositoryA = GitStateRepository.attach(fixture.cloneA, fixture.stateA)
    const repositoryB = GitStateRepository.attach(fixture.cloneB, fixture.stateB)
    const coordinator = new GitCommandRetryCoordinator(repositoryA)
    const bundle = initializeRun(coordinator)
    const sharedTask = taskId(bundle, 'task-shared')
    coordinator.executeAndPush({
      command: assignmentCommand('command.assign.config', sharedTask),
      schedulerId: 'scheduler.1'
    })
    coordinator.executeAndPush({
      command: announcementCommand('a', sharedTask),
      schedulerId: 'scheduler.1'
    })
    const snapshot = effectiveConfigSnapshot(sharedTask)
    const command = startAttemptCommand(snapshot, sharedTask)

    expect(() => coordinator.executeAndPush({ command, schedulerId: 'scheduler.1' })).toThrow(
      expect.objectContaining({ code: 'effective_config_snapshot_required' })
    )
    coordinator.executeAndPush({
      command,
      schedulerId: 'scheduler.1',
      effectiveConfigSnapshot: snapshot
    })

    repositoryB.alignToRemote()
    expect(repositoryB.loadEffectiveConfigSnapshot('run.git', 'attempt.a')).toEqual(snapshot)
    expect(
      git(fixture.stateB, ['ls-files', '.workflow/runs/run.git/attempt-configs']).split('\n')
    ).toHaveLength(1)
  })

  it('continues a started Role Task from an independent clone without local device registration', () => {
    const fixture = createGitFixture()
    const repositoryA = GitStateRepository.attach(fixture.cloneA, fixture.stateA)
    const repositoryB = GitStateRepository.attach(fixture.cloneB, fixture.stateB)
    const coordinatorA = new GitCommandRetryCoordinator(repositoryA)
    const coordinatorB = new GitCommandRetryCoordinator(repositoryB)
    const bundle = initializeRun(coordinatorA)
    const task = taskId(bundle, 'task-shared')
    coordinatorA.executeAndPush({
      command: assignmentCommand('command.assign.continue', task),
      schedulerId: 'scheduler.1'
    })
    coordinatorA.executeAndPush({
      command: announcementCommand('a', task),
      schedulerId: 'scheduler.1'
    })
    const snapshot = effectiveConfigSnapshot(task)
    coordinatorA.executeAndPush({
      command: startAttemptCommand(snapshot, task),
      schedulerId: 'scheduler.1',
      effectiveConfigSnapshot: snapshot
    })

    const result = buildAttemptResult(
      {
        schemaVersion: '1.0.0',
        status: 'submitted',
        summary: 'Completed from clone B.',
        verifications: [],
        risks: [],
        followUps: [],
        artifacts: [],
        usage: { status: 'unknown' }
      },
      {
        workflowRunId: 'run.git',
        nodeRunId: 'node-run.task-shared',
        taskId: task,
        attemptId: 'attempt.a',
        roleInstanceId: 'role-instance.a',
        executorInvocationId: 'executor-invocation.a',
        effectiveConfigHash: snapshot.contentHash,
        createdAt: '2026-07-27T12:07:00Z'
      }
    )
    const continued = coordinatorB.executeAndPush({
      command: {
        schemaVersion: '1.0.0',
        commandId: 'command.submit.from-clone-b',
        issuedAt: '2026-07-27T12:07:00Z',
        workflowRunId: 'run.git',
        taskId: task,
        actor: {
          kind: 'executor',
          roleInstanceId: 'role-instance.a',
          attemptId: 'attempt.a',
          executorInvocationId: 'executor-invocation.a'
        },
        type: 'submit_attempt_result',
        attemptId: 'attempt.a',
        result
      },
      schedulerId: 'scheduler.1'
    })
    expect(continued.projection.attempts['attempt.a']).toMatchObject({
      status: 'submitted',
      result: { summary: 'Completed from clone B.' }
    })
    repositoryA.alignToRemote()
    expect(repositoryA.rebuild('run.git').stateHash).toBe(continued.projection.stateHash)
  })
})

function initializeRun(coordinator: GitCommandRetryCoordinator): WorkflowRunBundle {
  const bundle = createWorkflowRunBundle({
    runId: 'run.git',
    definition: stateTestWorkflow(),
    roleCatalog: [
      {
        roleProfileId: 'role.developer',
        roleProfileVersion: 1,
        contentHash: 'a'.repeat(64)
      }
    ],
    createdAt: '2026-07-27T12:00:00Z'
  })
  coordinator.executeAndPush({
    command: createWorkflowRunCommand({
      bundle,
      commandId: 'command.create.run',
      schedulerId: 'scheduler.1',
      issuedAt: '2026-07-27T12:00:00Z'
    }),
    schedulerId: 'scheduler.1',
    runBundle: bundle
  })
  return bundle
}

function taskId(bundle: WorkflowRunBundle, nodeId: string): string {
  return bundle.taskCatalog.find((task) => task.nodeId === nodeId)!.id
}

function stateTestWorkflow(): WorkflowDefinition {
  const taskNodeIds = ['task-a', 'task-b', 'task-same', 'task-shared']
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.git-state-test',
    name: 'Git state test',
    version: 1,
    nodes: [
      { id: 'fan-out', type: 'parallel', branches: taskNodeIds },
      ...taskNodeIds.map(stateTestRoleNode),
      { id: 'join', type: 'join', waitFor: taskNodeIds },
      { id: 'finish', type: 'finish', inputs: [] }
    ],
    edges: [
      ...taskNodeIds.map((to) => ({ from: 'fan-out', to })),
      ...taskNodeIds.map((from) => ({ from, to: 'join' })),
      { from: 'join', to: 'finish' }
    ],
    maxTransitions: 40,
    maxRunCostUsd: 20,
    maxRunDurationSeconds: 3_600
  }
}

function stateTestRoleNode(id: string) {
  return {
    id,
    type: 'role_task' as const,
    recommendedRoleProfileIds: ['role.developer'],
    allowedRoleProfileIds: ['role.developer'],
    instruction: `Complete ${id}.`,
    workspaceMode: 'write' as const,
    inputs: [],
    outputs: [
      {
        schemaVersion: '1.0.0' as const,
        artifactType: `artifact.${id}`,
        format: 'diff' as const,
        required: true,
        maxBytes: 1_000_000
      }
    ]
  }
}

function createGitFixture(): {
  cloneA: string
  cloneB: string
  stateA: string
  stateB: string
} {
  const root = mkdtempSync(join(tmpdir(), 'mam-git-state-'))
  temporaryDirectories.push(root)
  const origin = join(root, 'origin.git')
  const seed = join(root, 'seed')
  const cloneA = join(root, 'clone-a')
  const cloneB = join(root, 'clone-b')
  mkdirSync(seed)
  git(root, ['init', '--bare', origin])
  git(seed, ['init'])
  configureIdentity(seed)
  writeFileSync(join(seed, 'README.md'), '# fixture\n')
  git(seed, ['add', 'README.md'])
  git(seed, ['commit', '-m', 'fixture: initialize'])
  git(seed, ['branch', '-M', 'main'])
  git(seed, ['remote', 'add', 'origin', origin])
  git(seed, ['push', '-u', 'origin', 'main'])
  git(origin, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  git(root, ['clone', origin, cloneA])
  git(root, ['clone', origin, cloneB])
  configureIdentity(cloneA)
  configureIdentity(cloneB)
  return {
    cloneA,
    cloneB,
    stateA: join(root, 'state-a'),
    stateB: join(root, 'state-b')
  }
}

function assignmentCommand(
  commandId: string,
  taskId: string,
  roleProfileId = 'role.developer',
  roleProfileVersion = 1
): SchedulerCommand {
  return {
    schemaVersion: '1.0.0',
    commandId,
    issuedAt: `2026-07-27T12:0${taskId === 'task.a' ? '1' : '2'}:00Z`,
    workflowRunId: 'run.git',
    taskId,
    actor: { kind: 'user', userId: 'user.owner' },
    type: 'assign_task',
    roleProfileId,
    roleProfileVersion
  }
}

function resolutionCommand(
  conflictId: string
): Extract<SchedulerCommand, { type: 'resolve_state_conflict' }> {
  return {
    schemaVersion: '1.0.0',
    commandId: 'command.resolve.competing',
    issuedAt: '2026-07-27T12:03:00Z',
    workflowRunId: 'run.git',
    actor: { kind: 'user', userId: 'user.owner' },
    type: 'resolve_state_conflict',
    conflictId,
    resolution: 'accept_remote_state',
    rationale: 'Keep the Assignment that reached mam-state first.'
  }
}

function announcementCommand(suffix: 'a' | 'b', taskId: string): SchedulerCommand {
  return {
    schemaVersion: '1.0.0',
    commandId: `command.announce.${suffix}`,
    issuedAt: `2026-07-27T12:0${suffix === 'a' ? '4' : '5'}:00Z`,
    workflowRunId: 'run.git',
    taskId,
    actor: { kind: 'scheduler', schedulerId: 'scheduler.1' },
    type: 'announce_execution',
    claimId: `claim.${suffix}`,
    attemptId: `attempt.${suffix}`,
    executorInstanceId: `executor.${suffix}`
  }
}

function startAttemptCommand(
  snapshot: EffectiveRoleConfigSnapshot,
  taskId: string
): SchedulerCommand {
  return {
    schemaVersion: '1.0.0',
    commandId: 'command.start.a',
    issuedAt: '2026-07-27T12:06:00Z',
    workflowRunId: 'run.git',
    taskId,
    actor: { kind: 'scheduler', schedulerId: 'scheduler.1' },
    type: 'start_attempt',
    attemptId: 'attempt.a',
    roleInstanceId: 'role-instance.a',
    executorInvocationId: 'executor-invocation.a',
    effectiveConfigSnapshotId: snapshot.id,
    effectiveConfigHash: snapshot.contentHash
  }
}

function effectiveConfigSnapshot(taskId: string): EffectiveRoleConfigSnapshot {
  const hash = 'a'.repeat(64)
  const reference = { id: 'profile', version: 1, contentHash: hash }
  const base = {
    schemaVersion: '1.0.0' as const,
    id: 'effective.attempt.a',
    workflowRunId: 'run.git',
    taskId,
    attemptId: 'attempt.a',
    roleProfile: { ...reference, id: 'role.developer' },
    executorProfile: { ...reference, id: 'executor.codex', kind: 'codex-cli' as const },
    providerProfile: { ...reference, id: 'provider.compatible' },
    modelProfile: { ...reference, id: 'model.compatible' },
    systemPromptRef: 'prompt.developer',
    execution: {
      executableRef: 'codex',
      adapterOptions: {},
      providerProtocol: 'openai-responses' as const,
      providerSecretRef: 'secret.provider',
      remoteModelId: 'model-id',
      modelCapabilities: {
        modalities: ['text' as const],
        supportsTools: true,
        supportsStructuredOutput: true
      },
      inference: {}
    },
    skills: [],
    mcpBindings: [],
    knowledgeBaseBindings: [],
    tools: [],
    permissions: {
      readPaths: ['.'],
      writePaths: ['.'],
      allowedCommands: [],
      deniedCommands: [],
      allowedNetworkHosts: [],
      requireApprovalFor: []
    },
    budget: {
      maxInputTokens: 10_000,
      maxOutputTokens: 2_000,
      maxCostUsd: 1,
      maxDurationSeconds: 600
    },
    retry: { maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0 },
    contextPolicy: {
      maxContextTokens: 10_000,
      compaction: 'disabled' as const,
      includePreviousAttempts: false
    },
    localBindingIds: ['binding.secret.provider'],
    createdAt: '2026-07-27T12:06:00Z'
  }
  return { ...base, contentHash: profileContentHash(base) }
}

function configureIdentity(directory: string): void {
  git(directory, ['config', 'user.name', 'MAM Git State Test'])
  git(directory, ['config', 'user.email', 'mam-git-state@example.invalid'])
}

function git(directory: string, args: readonly string[]): string {
  return execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {
    cwd: directory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}
