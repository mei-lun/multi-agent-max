import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RoleProfile } from '../../../../shared/mam/domain/role'
import type { WorkflowDefinition } from '../../../../shared/mam/domain/workflow'
import { ProfileCatalog } from '../../profiles/profile-catalog'
import { MamLocalSettingsStore } from '../../profiles/mam-local-settings-store'
import { GitCommandRetryCoordinator } from '../../state-store/git-command-retry-coordinator'
import { GitStateRepository } from '../../state-store/git-state-repository'
import { MamUiQueryService } from '../mam-ui-query-service'
import { createWorkflowRunBundle, createWorkflowRunCommand } from '../workflow-run-factory'

export function createAttemptExecutionAcceptanceFixture(input?: {
  mergeValidations?: readonly string[]
}) {
  const root = mkdtempSync(join(tmpdir(), 'mam-attempt-execution-'))
  const origin = join(root, 'origin.git')
  const project = join(root, 'project')
  git(root, ['init', '--bare', origin])
  mkdirSync(project)
  git(project, ['init'])
  git(project, ['config', 'user.name', 'MAM Attempt Test'])
  git(project, ['config', 'user.email', 'mam-attempt@example.invalid'])
  writeFileSync(join(project, 'README.md'), '# before\n')
  git(project, ['add', 'README.md'])
  git(project, ['commit', '-m', 'fixture: initialize'])
  git(project, ['branch', '-M', 'main'])
  git(project, ['remote', 'add', 'origin', origin])
  git(project, ['push', '-u', 'origin', 'main'])
  git(origin, ['symbolic-ref', 'HEAD', 'refs/heads/main'])

  const catalog = new ProfileCatalog(join(root, 'catalog'))
  const executor = catalog.executors.save({
    id: 'executor.codex',
    version: 1,
    kind: 'codex-cli',
    executableRef: 'codex',
    adapterOptions: { mode: 'headless' }
  })
  const provider = catalog.providers.save({
    id: 'provider.test',
    version: 1,
    protocol: 'openai-responses'
  })
  const model = catalog.models.save({
    id: 'model.test',
    version: 1,
    displayName: 'Test Model',
    providerProfileId: provider.id,
    remoteModelId: 'test-model',
    capabilities: {
      modalities: ['text'],
      supportsTools: true,
      supportsStructuredOutput: true
    }
  })
  const role = catalog.roles.save(roleProfile('role.builder', 'Builder', executor.id, model.id))
  const reviewerRole = catalog.roles.save(
    roleProfile('role.reviewer', 'Reviewer', executor.id, model.id)
  )
  const definition = catalog.workflows.save(workflow(input?.mergeValidations))
  const settings = new MamLocalSettingsStore(join(root, 'local-settings.json'), 'machine.test')
  settings.save({
    schemaVersion: '1.0.0',
    bindingIdentity: 'machine.test',
    gitExecutable: 'git',
    executorBindings: [
      {
        id: 'binding.executor.codex',
        executorProfileId: executor.id,
        executablePath: process.execPath,
        configRoot: join(root, 'executor-config'),
        bindingIdentity: 'machine.test'
      }
    ],
    secretBindings: [],
    skillBindings: [],
    knowledgeBindings: []
  })
  const repository = GitStateRepository.attach(project)
  const bundle = createWorkflowRunBundle({
    runId: 'run.attempt-execution',
    definition,
    roleCatalog: [
      {
        roleProfileId: role.id,
        roleProfileVersion: role.version,
        contentHash: catalog.roles.contentHash(role)
      },
      {
        roleProfileId: reviewerRole.id,
        roleProfileVersion: reviewerRole.version,
        contentHash: catalog.roles.contentHash(reviewerRole)
      }
    ],
    roleProfiles: [role, reviewerRole],
    createdAt: '2026-07-28T23:00:00Z'
  })
  const coordinator = new GitCommandRetryCoordinator(repository)
  coordinator.executeAndPush({
    command: createWorkflowRunCommand({
      bundle,
      commandId: 'command.create-run',
      schedulerId: 'scheduler.desktop',
      issuedAt: '2026-07-28T23:00:00Z'
    }),
    schedulerId: 'scheduler.desktop',
    runBundle: bundle
  })
  const taskId = bundle.taskCatalog.find((task) => task.nodeId === 'build')!.id
  coordinator.executeAndPush({
    command: {
      schemaVersion: '1.0.0',
      commandId: 'command.assign-role',
      issuedAt: '2026-07-28T23:00:01Z',
      workflowRunId: bundle.run.id,
      taskId,
      actor: { kind: 'user', userId: 'user.owner' },
      type: 'assign_task',
      roleProfileId: role.id,
      roleProfileVersion: role.version
    },
    schedulerId: 'scheduler.desktop'
  })
  const query = new MamUiQueryService(catalog, repository, () => '2026-07-28T23:01:00Z')
  return {
    root,
    project,
    catalog,
    settings,
    repository,
    query,
    bundle,
    taskId,
    reviewerRole,
    dispose: () => rmSync(root, { recursive: true, force: true })
  }
}

function roleProfile(
  id: string,
  displayName: string,
  executorProfileId: string,
  modelProfileId: string
): RoleProfile {
  return {
    schemaVersion: '1.0.0',
    id,
    version: 1,
    displayName,
    execution: { executorProfileId, modelProfileId },
    systemPromptRef: 'inline:Implement the assigned task and provide verifiable evidence.',
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

function workflow(mergeValidations: readonly string[] = []): WorkflowDefinition {
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.attempt-execution',
    name: 'Attempt execution acceptance',
    version: 1,
    nodes: [
      {
        id: 'build',
        type: 'role_task',
        recommendedRoleProfileIds: ['role.builder'],
        allowedRoleProfileIds: ['role.builder'],
        instruction: 'Update README and produce a diff Artifact.',
        workspaceMode: 'write',
        inputs: [],
        outputs: [
          {
            schemaVersion: '1.0.0',
            artifactType: 'artifact.patch',
            format: 'diff',
            required: true,
            maxBytes: 100_000
          }
        ]
      },
      {
        id: 'review',
        type: 'review_gate',
        recommendedRoleProfileIds: ['role.reviewer'],
        allowedRoleProfileIds: ['role.reviewer'],
        inputs: [
          {
            artifactId: 'artifact.patch',
            version: 1,
            contentHash: 'a'.repeat(64)
          }
        ],
        reportContract: {
          schemaVersion: '1.0.0',
          artifactType: 'review.report',
          format: 'markdown',
          required: true,
          maxBytes: 100_000,
          requiredSections: ['summary']
        },
        minimumDecisions: 1,
        maxRevisionAttempts: 2
      },
      {
        id: 'merge',
        type: 'git_merge',
        recommendedRoleProfileIds: ['role.reviewer'],
        allowedRoleProfileIds: ['role.reviewer'],
        targetBranch: 'main',
        orderBy: 'merge_ready_at',
        strategy: 'no_ff',
        conflictPolicy: 'coordinator_attempt',
        validations: [...mergeValidations]
      },
      { id: 'finish', type: 'finish', inputs: [] }
    ],
    edges: [
      { from: 'build', to: 'review' },
      { from: 'review', to: 'merge' },
      { from: 'merge', to: 'finish' }
    ],
    maxTransitions: 10,
    maxRunCostUsd: 5,
    maxRunDurationSeconds: 600
  }
}

function git(directory: string, args: readonly string[]): string {
  return execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {
    cwd: directory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}
