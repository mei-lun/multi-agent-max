import type { MamUiRunSnapshot, MamUiSnapshot } from '../../../../shared/mam/ui-projection'

const hash = 'a'.repeat(64)

export function mamUiRunFixture(): MamUiRunSnapshot {
  return {
    run: {
      schemaVersion: '1.0.0',
      id: 'run.ui',
      definitionId: 'workflow.ui',
      definitionVersion: 1,
      planHash: hash,
      roleCatalog: [],
      stateBackend: 'git',
      status: 'running',
      nodeRuns: [],
      createdAt: '2026-07-28T17:00:00Z',
      updatedAt: '2026-07-28T18:00:00Z'
    },
    definitionName: 'UI workflow',
    revision: hash,
    stateHash: hash,
    nodeRuns: [],
    readyTaskIds: [],
    tasks: [],
    attempts: [],
    reviews: [],
    reviewAggregations: [],
    reviewDisagreementResolutions: [],
    mergeQueueEntries: [],
    mergeConflictTasks: [],
    mergeConflictResolutions: []
  }
}

export const mamUiFixtureHash = hash

export function mamUiSnapshotFixture(): MamUiSnapshot {
  return {
    schemaVersion: '1.0.0',
    generatedAt: '2026-07-28T18:00:00Z',
    roles: [mamUiRoleFixture()],
    executors: [],
    providers: [],
    models: [],
    skills: [],
    mcpServers: [],
    knowledgeBases: [],
    workflows: [],
    localSettings: {
      schemaVersion: '1.0.0',
      bindingIdentity: 'machine.test',
      gitExecutable: 'git',
      executorBindings: [],
      secretBindings: [],
      skillBindings: [],
      knowledgeBindings: []
    },
    runs: [mamUiRunFixture()],
    issues: []
  }
}

export function mamUiRoleFixture(): MamUiSnapshot['roles'][number] {
  return {
    schemaVersion: '1.0.0',
    id: 'role.builder',
    version: 1,
    displayName: 'Builder',
    execution: { executorProfileId: 'executor.codex', modelProfileId: 'model.codex' },
    systemPromptRef: 'prompt.builder',
    skillBindings: [],
    mcpBindings: [],
    knowledgeBaseBindings: [],
    tools: [],
    permissions: {
      readPaths: [],
      writePaths: [],
      allowedCommands: [],
      deniedCommands: [],
      allowedNetworkHosts: [],
      requireApprovalFor: []
    },
    budget: {
      maxInputTokens: 100,
      maxOutputTokens: 100,
      maxCostUsd: 1,
      maxDurationSeconds: 60
    },
    retry: { maxAttempts: 2, initialBackoffMs: 0, maxBackoffMs: 0 },
    contextPolicy: {
      maxContextTokens: 100,
      compaction: 'disabled',
      includePreviousAttempts: true
    }
  }
}
