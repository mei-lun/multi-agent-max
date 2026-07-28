import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { MamSkillDefinition } from '../../../shared/mam/domain/skill-definition'
import type { WorkflowDefinition } from '../../../shared/mam/domain/workflow'
import { createWorkflowRunBundle, createWorkflowRunCommand } from './workflow-run-factory'
import { GitCommandRetryCoordinator } from '../state-store/git-command-retry-coordinator'
import { GitStateRepository } from '../state-store/git-state-repository'
import { MamUiCommandService } from './mam-ui-command-service'
import { MamUiQueryService } from './mam-ui-query-service'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('MAM UI command service with real Git state', () => {
  it('persists user Assignment and Scheduler recovery before returning a rebuilt snapshot', () => {
    const project = createProject()
    const repository = GitStateRepository.attach(project)
    const coordinator = new GitCommandRetryCoordinator(repository)
    const bundle = createWorkflowRunBundle({
      runId: 'run.ui-command',
      definition: workflow(),
      roleCatalog: [
        {
          roleProfileId: 'role.builder',
          roleProfileVersion: 2,
          contentHash: 'a'.repeat(64)
        }
      ],
      createdAt: '2026-07-28T21:00:00Z'
    })
    coordinator.executeAndPush({
      command: createWorkflowRunCommand({
        bundle,
        commandId: 'command.create.ui-command',
        schedulerId: 'scheduler.desktop',
        issuedAt: '2026-07-28T21:00:00Z'
      }),
      schedulerId: 'scheduler.desktop',
      runBundle: bundle
    })
    const taskId = bundle.taskCatalog[0]!.id
    const query = new MamUiQueryService(profileSource(), repository, () => '2026-07-28T21:10:00Z')
    let commandNumber = 0
    const service = new MamUiCommandService(
      query,
      {
        userId: 'user.owner',
        schedulerId: 'scheduler.desktop',
        now: () => '2026-07-28T21:01:00Z',
        createId: (kind) =>
          kind === 'attempt' ? 'attempt.replacement' : `command.ui.${String((commandNumber += 1))}`
      },
      repository
    )

    const assigned = service.assignTask({
      workflowRunId: bundle.run.id,
      taskId,
      roleProfileId: 'role.builder',
      roleProfileVersion: 2
    })
    expect(assigned.runs[0]?.tasks[0]).toMatchObject({
      id: taskId,
      status: 'ready',
      roleProfileId: 'role.builder',
      assignedByUserId: 'user.owner'
    })

    coordinator.executeAndPush({
      command: {
        schemaVersion: '1.0.0',
        commandId: 'command.announce.crashed',
        issuedAt: '2026-07-28T21:02:00Z',
        workflowRunId: bundle.run.id,
        taskId,
        actor: { kind: 'scheduler', schedulerId: 'scheduler.desktop' },
        type: 'announce_execution',
        claimId: 'claim.crashed',
        attemptId: 'attempt.crashed',
        executorInstanceId: 'executor.crashed'
      },
      schedulerId: 'scheduler.desktop'
    })
    const recovered = service.recoverAttempt({
      workflowRunId: bundle.run.id,
      taskId,
      previousAttemptId: 'attempt.crashed',
      resolution: 'start_new_attempt',
      reason: 'The Executor exited before submitting a terminal result.'
    })
    expect(recovered.runs[0]?.attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'attempt.crashed', status: 'blocked' }),
        expect.objectContaining({ id: 'attempt.replacement', status: 'recovery_planned' })
      ])
    )
    expect(recovered.runs[0]?.tasks[0]?.status).toBe('ready')
  })

  it('rejects a command before a project is attached', () => {
    const query = new MamUiQueryService(profileSource(), undefined)
    const service = new MamUiCommandService(query, {
      userId: 'user.owner',
      schedulerId: 'scheduler.desktop'
    })
    expect(() =>
      service.assignTask({
        workflowRunId: 'run.missing',
        taskId: 'task.missing',
        roleProfileId: 'role.builder',
        roleProfileVersion: 1
      })
    ).toThrow(expect.objectContaining({ code: 'project_not_attached' }))
  })

  it('compiles a Workflow before saving and activating its new version', () => {
    const saved: WorkflowDefinition[] = []
    const query = new MamUiQueryService(
      {
        roles: { listActive: () => [] },
        workflows: { listActive: () => saved }
      },
      undefined
    )
    const service = new MamUiCommandService(
      query,
      { userId: 'user.owner', schedulerId: 'scheduler.desktop' },
      undefined,
      writableProfiles(saved)
    )

    const definition = { ...workflow(), version: 2, name: 'Edited workflow' }
    expect(service.saveWorkflow({ definition }).workflows).toEqual([definition])
    expect(() =>
      service.saveWorkflow({
        definition: {
          ...definition,
          version: 3,
          edges: [
            { from: 'build', to: 'finish' },
            { from: 'finish', to: 'build' }
          ]
        }
      })
    ).toThrow()
  })
})

function workflow(): WorkflowDefinition {
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.ui-command',
    name: 'UI command workflow',
    version: 1,
    nodes: [
      {
        id: 'build',
        type: 'role_task',
        recommendedRoleProfileIds: ['role.builder'],
        allowedRoleProfileIds: ['role.builder'],
        instruction: 'Build the command fixture.',
        workspaceMode: 'write',
        inputs: [],
        outputs: [
          {
            schemaVersion: '1.0.0',
            artifactType: 'artifact.patch',
            format: 'diff',
            required: true,
            maxBytes: 1_000_000
          }
        ]
      },
      { id: 'finish', type: 'finish', inputs: [] }
    ],
    edges: [{ from: 'build', to: 'finish' }],
    maxTransitions: 10,
    maxRunCostUsd: 5,
    maxRunDurationSeconds: 600
  }
}

function profileSource() {
  return {
    roles: { listActive: () => [] },
    workflows: { listActive: () => [] }
  }
}

function writableProfiles(saved: WorkflowDefinition[]) {
  const empty = { save: (input: unknown) => input, listVersions: () => [] }
  return {
    roles: empty,
    executors: empty,
    providers: empty,
    models: empty,
    skills: {
      save: (input: unknown) => input as MamSkillDefinition,
      listVersions: () => []
    },
    mcpServers: empty,
    knowledgeBases: empty,
    workflows: {
      save: (input: unknown) => {
        const definition = input as WorkflowDefinition
        saved.splice(0, saved.length, definition)
        return definition
      },
      listVersions: () => saved
    }
  }
}

function createProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'mam-ui-command-'))
  temporaryDirectories.push(root)
  const origin = join(root, 'origin.git')
  const project = join(root, 'project')
  git(root, ['init', '--bare', origin])
  mkdirSync(project)
  git(project, ['init'])
  git(project, ['config', 'user.name', 'MAM UI Command Test'])
  git(project, ['config', 'user.email', 'mam-ui-command@example.invalid'])
  writeFileSync(join(project, 'README.md'), '# UI command fixture\n')
  git(project, ['add', 'README.md'])
  git(project, ['commit', '-m', 'fixture: initialize'])
  git(project, ['branch', '-M', 'main'])
  git(project, ['remote', 'add', 'origin', origin])
  git(project, ['push', '-u', 'origin', 'main'])
  git(origin, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  return project
}

function git(directory: string, args: readonly string[]): string {
  return execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {
    cwd: directory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}
