import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { EffectiveRoleConfigSnapshot, RoleProfile } from '../../../shared/mam/domain/role'
import type { WorkflowDefinition } from '../../../shared/mam/domain/workflow'
import { GitStateRepository } from '../state-store/git-state-repository'
import { MamUiQueryService } from './mam-ui-query-service'
import {
  MamWorkflowRunCommandService,
  type MamWorkflowRunCatalog
} from './mam-workflow-run-command-service'
import { profileContentHash } from '../profiles/profile-content-hash'
import { GitCommandRetryCoordinator } from '../state-store/git-command-retry-coordinator'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import { attemptBranchName } from './attempt-worktree-manager'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('MAM Workflow Run command service', () => {
  it('freezes the active referenced Roles and publishes a rebuildable Run Bundle', () => {
    const repository = GitStateRepository.attach(createProject())
    const definition = workflow()
    const role = roleProfile(3)
    const catalog = testCatalog(definition, role)
    const query = new MamUiQueryService(catalog, repository, () => '2026-07-28T22:00:01Z')
    const service = new MamWorkflowRunCommandService(
      query,
      catalog,
      'scheduler.desktop',
      repository,
      () => '2026-07-28T22:00:00Z',
      (kind) => (kind === 'run' ? 'run.created-in-ui' : 'command.create-in-ui')
    )

    const snapshot = service.create({
      definitionId: definition.id,
      definitionVersion: definition.version,
      inputArtifacts: []
    })

    expect(snapshot.runs[0]?.run).toMatchObject({
      id: 'run.created-in-ui',
      definitionId: definition.id,
      roleCatalog: [
        {
          roleProfileId: role.id,
          roleProfileVersion: role.version,
          contentHash: profileContentHash(role)
        }
      ]
    })
    expect(repository.loadRunBundle('run.created-in-ui')?.definition).toEqual(definition)
    expect(repository.rebuild('run.created-in-ui').workflow).toMatchObject({
      definitionId: definition.id,
      definitionVersion: definition.version
    })
  })

  it('requires an attached project before publishing state', () => {
    const definition = workflow()
    const role = roleProfile(1)
    const catalog = testCatalog(definition, role)
    const query = new MamUiQueryService(catalog, undefined)
    const service = new MamWorkflowRunCommandService(query, catalog, 'scheduler.desktop')

    expect(() =>
      service.create({
        definitionId: definition.id,
        definitionVersion: definition.version,
        inputArtifacts: []
      })
    ).toThrow(expect.objectContaining({ code: 'project_not_attached' }))
  })

  it('cancels immutable history and starts a fresh replacement Run', () => {
    const repository = GitStateRepository.attach(createProject())
    const definition = workflow()
    const role = roleProfile(3)
    const catalog = testCatalog(definition, role)
    const query = new MamUiQueryService(catalog, repository, () => '2026-07-28T22:05:00Z')
    let runNumber = 0
    let commandNumber = 0
    const service = new MamWorkflowRunCommandService(
      query,
      catalog,
      'scheduler.desktop',
      repository,
      () => '2026-07-28T22:00:00Z',
      (kind) =>
        kind === 'run' ? `run.restart.${++runNumber}` : `command.restart.${++commandNumber}`
    )
    service.create({
      definitionId: definition.id,
      definitionVersion: definition.version,
      inputArtifacts: []
    })

    const snapshot = service.restart({ workflowRunId: 'run.restart.1' })

    expect(snapshot.runs.map((run) => [run.run.id, run.run.status])).toEqual([
      ['run.restart.1', 'cancelled'],
      ['run.restart.2', 'running']
    ])
    expect(repository.rebuild('run.restart.1').cancellation).toBeDefined()
    expect(repository.loadRunBundle('run.restart.2')?.definition).toEqual(definition)
  })

  it('reuses a compatible submitted Task result when cleaning and continuing', () => {
    const project = createProject()
    const repository = GitStateRepository.attach(project)
    const definition = workflow()
    const role = roleProfile(3)
    const catalog = testCatalog(definition, role)
    const query = new MamUiQueryService(catalog, repository, () => '2026-07-28T22:05:00Z')
    let runNumber = 0
    let commandNumber = 0
    const service = new MamWorkflowRunCommandService(
      query,
      catalog,
      'scheduler.desktop',
      repository,
      () => '2026-07-28T22:00:00Z',
      (kind) => (kind === 'run' ? `run.reuse.${++runNumber}` : `command.reuse.${++commandNumber}`)
    )
    service.create({
      definitionId: definition.id,
      definitionVersion: definition.version,
      inputArtifacts: []
    })
    const sourceBundle = repository.loadRunBundle('run.reuse.1')!
    const sourceTask = sourceBundle.taskCatalog[0]!
    const attemptId = 'attempt.reusable-result'
    const submittedCommit = git(project, ['rev-parse', '--verify', 'HEAD^{commit}'])
    const effectiveConfig = effectiveConfigSnapshot(sourceBundle.run.id, sourceTask.id, attemptId)
    git(project, ['branch', attemptBranchName(attemptId), submittedCommit])
    const commands: SchedulerCommand[] = [
      {
        ...taskEnvelope('command.source.assign', sourceBundle.run.id, sourceTask.id, {
          kind: 'user',
          userId: 'user.local'
        }),
        type: 'assign_task',
        roleProfileId: role.id,
        roleProfileVersion: role.version
      },
      {
        ...taskEnvelope('command.source.announce', sourceBundle.run.id, sourceTask.id),
        type: 'announce_execution',
        claimId: 'claim.reusable-result',
        attemptId,
        executorInstanceId: 'executor.instance.local'
      },
      {
        ...taskEnvelope('command.source.start', sourceBundle.run.id, sourceTask.id),
        type: 'start_attempt',
        attemptId,
        roleInstanceId: 'role.instance.reusable',
        executorInvocationId: 'invocation.reusable',
        effectiveConfigSnapshotId: 'config.reusable',
        effectiveConfigHash: effectiveConfig.contentHash
      },
      {
        ...taskEnvelope('command.source.result', sourceBundle.run.id, sourceTask.id, {
          kind: 'executor',
          roleInstanceId: 'role.instance.reusable',
          attemptId,
          executorInvocationId: 'invocation.reusable'
        }),
        type: 'submit_attempt_result',
        attemptId,
        result: {
          schemaVersion: '1.0.0',
          status: 'submitted',
          summary: 'Reusable verified result.',
          verifications: [],
          risks: [],
          followUps: [],
          artifacts: [],
          usage: { status: 'known', inputTokens: 100, outputTokens: 20 },
          system: {
            workflowRunId: sourceBundle.run.id,
            nodeRunId: sourceTask.nodeRunId,
            taskId: sourceTask.id,
            attemptId,
            roleInstanceId: 'role.instance.reusable',
            executorInvocationId: 'invocation.reusable',
            effectiveConfigHash: effectiveConfig.contentHash,
            submittedCommit,
            createdAt: '2026-07-28T22:00:00Z'
          }
        }
      }
    ]
    for (const command of commands) {
      new GitCommandRetryCoordinator(repository).executeAndPush({
        command,
        schedulerId: 'scheduler.desktop',
        ...(command.type === 'start_attempt' ? { effectiveConfigSnapshot: effectiveConfig } : {})
      })
    }

    const snapshot = service.restart({ workflowRunId: sourceBundle.run.id })
    const replacement = snapshot.runs.find((run) => run.run.id === 'run.reuse.2')!
    const reusedTask = replacement.tasks.find((task) => task.reusedFrom)

    expect(reusedTask).toMatchObject({
      status: 'submitted',
      reusedFrom: {
        workflowRunId: sourceBundle.run.id,
        taskId: sourceTask.id,
        attemptId
      }
    })
    expect(replacement.attempts).toEqual([
      expect.objectContaining({ id: attemptId, status: 'submitted' })
    ])
  })
})

function taskEnvelope(
  commandId: string,
  workflowRunId: string,
  taskId: string,
  actor: SchedulerCommand['actor'] = {
    kind: 'scheduler',
    schedulerId: 'scheduler.desktop'
  }
) {
  return {
    schemaVersion: '1.0.0' as const,
    commandId,
    issuedAt: '2026-07-28T22:00:00Z',
    workflowRunId,
    taskId,
    actor
  }
}

function effectiveConfigSnapshot(
  workflowRunId: string,
  taskId: string,
  attemptId: string
): EffectiveRoleConfigSnapshot {
  const hash = 'a'.repeat(64)
  const reference = { id: 'profile', version: 1, contentHash: hash }
  const base = {
    schemaVersion: '1.0.0' as const,
    id: 'config.reusable',
    workflowRunId,
    taskId,
    attemptId,
    roleProfile: { ...reference, id: 'role.builder' },
    executorProfile: { ...reference, id: 'executor.codex', kind: 'codex-cli' as const },
    providerProfile: { ...reference, id: 'provider.test' },
    modelProfile: { ...reference, id: 'model.builder' },
    systemPromptRef: 'prompt.builder',
    execution: {
      executableRef: 'codex',
      adapterOptions: {},
      providerProtocol: 'openai-responses' as const,
      remoteModelId: 'model.builder',
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
    localBindingIds: [],
    createdAt: '2026-07-28T22:00:00Z'
  }
  return { ...base, contentHash: profileContentHash(base) }
}

function testCatalog(definition: WorkflowDefinition, role: RoleProfile): MamWorkflowRunCatalog {
  return {
    roles: {
      get: () => role,
      listActive: () => [role],
      contentHash: (profile) => profileContentHash(profile)
    },
    workflows: {
      get: (id, version) =>
        id === definition.id && version === definition.version ? definition : undefined,
      listActive: () => [definition],
      contentHash: () => 'b'.repeat(64)
    }
  }
}

function workflow(): WorkflowDefinition {
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.ui-run',
    name: 'UI-created Run',
    version: 2,
    nodes: [
      {
        id: 'build',
        type: 'role_task',
        recommendedRoleProfileIds: ['role.builder'],
        allowedRoleProfileIds: ['role.builder'],
        instruction: 'Build the UI Run fixture.',
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

function roleProfile(version: number): RoleProfile {
  return {
    schemaVersion: '1.0.0',
    id: 'role.builder',
    version,
    displayName: 'Builder',
    execution: {
      executorProfileId: 'executor.codex',
      modelProfileId: 'model.builder'
    },
    systemPromptRef: 'prompt.builder',
    skillBindings: [],
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
      compaction: 'disabled',
      includePreviousAttempts: false
    }
  }
}

function createProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'mam-ui-run-'))
  temporaryDirectories.push(root)
  const origin = join(root, 'origin.git')
  const project = join(root, 'project')
  git(root, ['init', '--bare', origin])
  mkdirSync(project)
  git(project, ['init'])
  git(project, ['config', 'user.name', 'MAM UI Run Test'])
  git(project, ['config', 'user.email', 'mam-ui-run@example.invalid'])
  writeFileSync(join(project, 'README.md'), '# UI Run fixture\n')
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
