import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SchedulerCommand } from '../shared/mam/scheduler-protocol'
import type { WorkflowDefinition } from '../shared/mam/domain/workflow'
import {
  createWorkflowRunBundle,
  createWorkflowRunCommand
} from './mam/application/workflow-run-factory'
import { GitCommandRetryCoordinator } from './mam/state-store/git-command-retry-coordinator'
import { GitStateRepository } from './mam/state-store/git-state-repository'
import { ProfileCatalog } from './mam/profiles/profile-catalog'

const root = mkdtempSync(join(tmpdir(), 'mam-desktop-seeded-'))
const origin = join(root, 'origin.git')
const project = join(root, 'project')

beforeAll(() => {
  createProject()
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('desktop seeded-project acceptance', () => {
  it('rebuilds a non-empty Run from mam-state after the derived snapshot is deleted', () => {
    const seeded = seedRun()
    removeDerivedSnapshot(seeded.repository)
    const launcher = join(
      process.cwd(),
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'electron-vite.cmd' : 'electron-vite'
    )
    const userData = join(root, 'user-data')
    new ProfileCatalog(join(userData, 'mam', 'catalog')).workflows.save(seededWorkflow())
    const result = spawnSync(launcher, ['preview'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MAM_DESKTOP_SMOKE: '1',
        MAM_DESKTOP_SMOKE_EXPECT: 'Seeded desktop workflow',
        MAM_DESKTOP_SMOKE_OPEN_WORKFLOW_EDITOR: '1',
        MAM_DESKTOP_SMOKE_SAVE_WORKFLOW: '1',
        MAM_DESKTOP_SMOKE_ASSIGN_TASK: JSON.stringify({
          workflowRunId: 'run.desktop-seeded',
          taskId: seeded.assignmentTaskId,
          roleProfileId: 'role.builder',
          roleProfileVersion: 1
        }),
        MAM_DESKTOP_SMOKE_RECOVER_ATTEMPT: JSON.stringify({
          workflowRunId: 'run.desktop-seeded',
          taskId: seeded.recoveryTaskId,
          previousAttemptId: 'attempt.desktop-crashed',
          resolution: 'start_new_attempt',
          reason: 'The seeded Executor stopped before a terminal result.'
        }),
        MAM_DESKTOP_SMOKE_USER_DATA: userData,
        MAM_PROJECT_DIRECTORY: project
      },
      encoding: 'utf8',
      shell: process.platform === 'win32',
      timeout: 60_000
    })

    expect(result.error).toBeUndefined()
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(result.stdout).toContain('"passed":true')
    expect(result.stdout).toContain('Seeded desktop workflow')
    expect(result.stdout).toContain('"commandTaskStatus":"ready"')
    expect(result.stdout).toContain('"recoveryOriginalStatus":"blocked"')
    expect(result.stdout).toContain('"recoveryReplacementStatus":"recovery_planned"')
    expect(result.stdout).toContain('"savedWorkflowVersion":2')
  })
})

function createProject(): void {
  git(root, ['init', '--bare', origin])
  mkdirSync(project)
  git(project, ['init'])
  configureIdentity(project)
  writeFileSync(join(project, 'README.md'), '# seeded desktop fixture\n')
  git(project, ['add', 'README.md'])
  git(project, ['commit', '-m', 'fixture: initialize'])
  git(project, ['branch', '-M', 'main'])
  git(project, ['remote', 'add', 'origin', origin])
  git(project, ['push', '-u', 'origin', 'main'])
  git(origin, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
}

function seedRun(): Readonly<{
  repository: GitStateRepository
  assignmentTaskId: string
  recoveryTaskId: string
}> {
  const repository = GitStateRepository.attach(project)
  const coordinator = new GitCommandRetryCoordinator(repository)
  const bundle = createWorkflowRunBundle({
    runId: 'run.desktop-seeded',
    definition: seededWorkflow(),
    roleCatalog: [
      {
        roleProfileId: 'role.builder',
        roleProfileVersion: 1,
        contentHash: 'a'.repeat(64)
      }
    ],
    createdAt: '2026-07-28T20:00:00Z'
  })
  coordinator.executeAndPush({
    command: createWorkflowRunCommand({
      bundle,
      commandId: 'command.desktop.create',
      schedulerId: 'scheduler.desktop',
      issuedAt: '2026-07-28T20:00:00Z'
    }),
    schedulerId: 'scheduler.desktop',
    runBundle: bundle
  })
  const assignmentTaskId = bundle.taskCatalog.find((task) => task.nodeId === 'assign-task')!.id
  const recoveryTaskId = bundle.taskCatalog.find((task) => task.nodeId === 'recover-task')!.id
  coordinator.executeAndPush({
    command: assignmentCommand(recoveryTaskId),
    schedulerId: 'scheduler.desktop'
  })
  coordinator.executeAndPush({
    command: announcementCommand(recoveryTaskId),
    schedulerId: 'scheduler.desktop'
  })
  return { repository, assignmentTaskId, recoveryTaskId }
}

function removeDerivedSnapshot(repository: GitStateRepository): void {
  const summary = join(
    repository.stateDirectory,
    '.workflow',
    'runs',
    'run.desktop-seeded',
    'snapshots',
    'summary.json'
  )
  rmSync(summary)
  git(repository.stateDirectory, ['add', '-u', '--', '.workflow'])
  git(repository.stateDirectory, ['commit', '-m', 'fixture: remove derived projection snapshot'])
  git(repository.stateDirectory, ['push', 'origin', 'HEAD:refs/heads/mam-state'])
}

function seededWorkflow(): WorkflowDefinition {
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.desktop-seeded',
    name: 'Seeded desktop workflow',
    version: 1,
    nodes: [
      { id: 'fan-out', type: 'parallel', branches: ['assign-task', 'recover-task'] },
      roleTask('assign-task'),
      roleTask('recover-task'),
      { id: 'join', type: 'join', waitFor: ['assign-task', 'recover-task'] },
      { id: 'finish', type: 'finish', inputs: [] }
    ],
    edges: [
      { from: 'fan-out', to: 'assign-task' },
      { from: 'fan-out', to: 'recover-task' },
      { from: 'assign-task', to: 'join' },
      { from: 'recover-task', to: 'join' },
      { from: 'join', to: 'finish' }
    ],
    maxTransitions: 10,
    maxRunCostUsd: 5,
    maxRunDurationSeconds: 600
  }
}

function roleTask(id: string) {
  return {
    id,
    type: 'role_task' as const,
    recommendedRoleProfileIds: ['role.builder'],
    allowedRoleProfileIds: ['role.builder'],
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

function assignmentCommand(taskId: string): Extract<SchedulerCommand, { type: 'assign_task' }> {
  return {
    schemaVersion: '1.0.0',
    commandId: 'command.desktop.assign-recovery',
    issuedAt: '2026-07-28T20:01:00Z',
    workflowRunId: 'run.desktop-seeded',
    taskId,
    actor: { kind: 'user', userId: 'user.desktop' },
    type: 'assign_task',
    roleProfileId: 'role.builder',
    roleProfileVersion: 1
  }
}

function announcementCommand(
  taskId: string
): Extract<SchedulerCommand, { type: 'announce_execution' }> {
  return {
    schemaVersion: '1.0.0',
    commandId: 'command.desktop.announce-recovery',
    issuedAt: '2026-07-28T20:02:00Z',
    workflowRunId: 'run.desktop-seeded',
    taskId,
    actor: { kind: 'scheduler', schedulerId: 'scheduler.desktop' },
    type: 'announce_execution',
    claimId: 'claim.desktop-crashed',
    attemptId: 'attempt.desktop-crashed',
    executorInstanceId: 'executor.desktop-crashed'
  }
}

function configureIdentity(directory: string): void {
  git(directory, ['config', 'user.name', 'MAM Desktop Smoke'])
  git(directory, ['config', 'user.email', 'mam-desktop@example.invalid'])
}

function git(directory: string, args: readonly string[]): string {
  return execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {
    cwd: directory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}
