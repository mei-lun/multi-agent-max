import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterAll, describe, expect, it } from 'vitest'
import type { EffectiveRoleConfigSnapshot } from '../../../shared/mam/domain/role'
import type { MaterializedAttemptResources } from '../profiles/attempt-resource-materializer'
import { profileContentHash } from '../profiles/profile-content-hash'
import { CodexHeadlessAdapter } from './codex-headless-adapter'

const directories: string[] = []

afterAll(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('Codex headless real smoke', () => {
  it('returns a schema-validated standard Attempt Result through the real CLI', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mam-codex-real-'))
    directories.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    const snapshot = smokeSnapshot(process.env.MAM_CODEX_SMOKE_MODEL ?? 'gpt-5.6-sol')
    const resources: MaterializedAttemptResources = {
      attemptId: snapshot.attemptId,
      rootDirectory: join(root, 'resources'),
      configPath: join(root, 'resources', 'effective-config.json'),
      manifestPath: join(root, 'resources', 'resource-manifest.json'),
      skillDirectories: {},
      contentHash: snapshot.contentHash
    }
    let execution
    try {
      execution = await new CodexHeadlessAdapter().execute({
        profile: {
          id: 'executor.codex',
          version: 1,
          kind: 'codex-cli',
          executableRef: 'executable.codex',
          adapterOptions: { mode: 'headless' }
        },
        binding: {
          id: 'binding.codex',
          executorProfileId: 'executor.codex',
          executablePath: process.env.MAM_CODEX_PATH ?? 'codex',
          configRoot: join(root, 'executor-config'),
          credentialSourcePath:
            process.env.MAM_CODEX_CREDENTIAL_SOURCE ?? join(homedir(), '.codex'),
          bindingIdentity: 'local.smoke'
        },
        snapshot,
        resources,
        executorInvocationId: 'executor-invocation.smoke',
        workspacePath: workspace,
        prompt: [
          'Do not use tools or inspect files.',
          'Return the required JSON result with status submitted, summary "Codex structured smoke passed.",',
          'empty verifications, risks, followUps, and artifacts, and usage status unknown.'
        ].join(' '),
        credentialValues: {},
        authority: {
          workflowRunId: snapshot.workflowRunId,
          nodeRunId: 'node-run.smoke',
          taskId: snapshot.taskId,
          attemptId: snapshot.attemptId,
          roleInstanceId: 'role-instance.smoke',
          executorInvocationId: 'executor-invocation.smoke',
          effectiveConfigHash: snapshot.contentHash,
          createdAt: new Date().toISOString()
        }
      })
    } catch (error) {
      await writeAcceptanceEvidence({
        status: 'failed',
        structuredResultValidated: false,
        model: snapshot.execution.remoteModelId,
        errorCode:
          error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown',
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }

    expect(execution.result.status).toBe('submitted')
    expect(execution.result.summary).toBe('Codex structured smoke passed.')
    expect(execution.events.length).toBeGreaterThan(0)
    await writeAcceptanceEvidence({
      status: 'passed',
      structuredResultValidated: true,
      model: snapshot.execution.remoteModelId,
      events: execution.events.map((event) => event.sourceEventType),
      usage: execution.usage,
      effectiveConfigHash: snapshot.contentHash
    })
  })
})

async function writeAcceptanceEvidence(value: Record<string, unknown>): Promise<void> {
  const path = join(process.cwd(), 'docs/acceptance/codex-headless-smoke.json')
  await writeFile(
    path,
    `${JSON.stringify(
      {
        schemaVersion: '1.0.0',
        generatedAt: new Date().toISOString(),
        ...value
      },
      null,
      2
    )}\n`
  )
}

function smokeSnapshot(model: string): EffectiveRoleConfigSnapshot {
  const hash = 'a'.repeat(64)
  const reference = { id: 'profile', version: 1, contentHash: hash }
  const base = {
    schemaVersion: '1.0.0' as const,
    id: 'effective.smoke',
    workflowRunId: 'run.smoke',
    taskId: 'task.smoke',
    attemptId: 'attempt.smoke',
    roleProfile: { ...reference, id: 'role.smoke' },
    executorProfile: { ...reference, id: 'executor.codex', kind: 'codex-cli' as const },
    providerProfile: { ...reference, id: 'provider.openai' },
    modelProfile: { ...reference, id: 'model.smoke' },
    systemPromptRef: 'prompt.smoke',
    execution: {
      executableRef: 'executable.codex',
      adapterOptions: { mode: 'headless' },
      providerProtocol: 'openai-responses' as const,
      remoteModelId: model,
      modelCapabilities: {
        modalities: ['text' as const],
        supportsTools: true,
        supportsStructuredOutput: true
      },
      inference: { reasoningEffort: 'low' }
    },
    skills: [],
    mcpBindings: [],
    knowledgeBaseBindings: [],
    tools: [],
    permissions: {
      readPaths: ['.'],
      writePaths: [],
      allowedCommands: [],
      deniedCommands: ['*'],
      allowedNetworkHosts: [],
      requireApprovalFor: []
    },
    budget: {
      maxInputTokens: 10_000,
      maxOutputTokens: 1_000,
      maxCostUsd: 1,
      maxDurationSeconds: 120
    },
    retry: { maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0 },
    contextPolicy: {
      maxContextTokens: 10_000,
      compaction: 'disabled' as const,
      includePreviousAttempts: false
    },
    localBindingIds: ['binding.codex'],
    createdAt: new Date().toISOString()
  }
  return { ...base, contentHash: profileContentHash(base) }
}
