import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  ExecutorProfile,
  LocalExecutorBinding
} from '../../../shared/mam/domain/execution-profile'
import type { EffectiveRoleConfigSnapshot } from '../../../shared/mam/domain/role'
import type { MaterializedAttemptResources } from '../profiles/attempt-resource-materializer'
import { profileContentHash } from '../profiles/profile-content-hash'
import { CodexHeadlessAdapter } from './codex-headless-adapter'
import type { CodexProcessRunner } from './codex-process-runner'
import { ExecutorLocalPreflight, type ExecutorProbe } from './executor-local-preflight'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('CodexHeadlessAdapter', () => {
  it('accepts only a structured result file and injects MAM-owned authority and usage', async () => {
    const fixture = await createFixture()
    const adapter = new CodexHeadlessAdapter(
      successfulRunner(),
      () => '2026-07-28T04:01:00Z',
      readyPreflight()
    )
    const execution = await adapter.execute(executionInput(fixture))

    expect(execution.result).toMatchObject({
      status: 'submitted',
      summary: 'Structured completion.',
      usage: { status: 'partial', inputTokens: 120, outputTokens: 30 },
      system: {
        workflowRunId: 'run.1',
        taskId: 'task.1',
        attemptId: 'attempt.1',
        executorInvocationId: 'executor-invocation.1',
        effectiveConfigHash: fixture.snapshot.contentHash
      }
    })
    expect(execution.events.map((event) => event.sourceEventType)).toEqual([
      'thread.started',
      'turn.started',
      'item.completed',
      'turn.completed'
    ])
    expect(execution.invocation.args).toContain('--output-schema')
    expect(execution.invocation.args).toContain('--json')
    expect(execution.invocation.env.MAM_CODEX_PROVIDER_KEY).toBe('secret-value-canary')
    expect(execution.invocation.env.HOME).toBeUndefined()
    expect(await readFile(execution.invocation.schemaPath, 'utf8')).not.toContain(
      'secret-value-canary'
    )
    expect(
      await readFile(
        join(execution.invocation.invocationDirectory, 'codex-home', 'config.toml'),
        'utf8'
      )
    ).toContain('[model_providers.mam]')
  })

  it('does not treat exit zero or a completed JSONL turn as Attempt completion', async () => {
    const fixture = await createFixture()
    const adapter = new CodexHeadlessAdapter(
      async () => ({
        exitCode: 0,
        signal: null,
        stdout: `${JSON.stringify({ type: 'turn.completed', usage: {} })}\n`,
        stderr: '',
        timedOut: false
      }),
      () => '2026-07-28T04:01:00Z',
      readyPreflight()
    )
    await expect(adapter.execute(executionInput(fixture))).rejects.toMatchObject({
      code: 'structured_result_missing'
    })
  })

  it('rejects malformed JSONL, invalid result shape, and excess credentials', async () => {
    const fixture = await createFixture()
    const malformedEvents = new CodexHeadlessAdapter(
      async (invocation) => {
        await writeFile(invocation.resultPath, JSON.stringify(agentPayload()))
        return {
          exitCode: 0,
          signal: null,
          stdout: 'not-json\n',
          stderr: '',
          timedOut: false
        }
      },
      () => '2026-07-28T04:01:00Z',
      readyPreflight()
    )
    await expect(malformedEvents.execute(executionInput(fixture))).rejects.toMatchObject({
      code: 'executor_event_error'
    })

    const invalidResult = new CodexHeadlessAdapter(
      async (invocation) => {
        await writeFile(invocation.resultPath, JSON.stringify({ status: 'done' }))
        return {
          exitCode: 0,
          signal: null,
          stdout: `${JSON.stringify({ type: 'turn.completed' })}\n`,
          stderr: '',
          timedOut: false
        }
      },
      () => '2026-07-28T04:01:00Z',
      readyPreflight()
    )
    await expect(
      invalidResult.execute({
        ...executionInput(fixture),
        executorInvocationId: 'executor-invocation.2'
      })
    ).rejects.toMatchObject({
      code: 'structured_result_invalid'
    })

    await expect(
      invalidResult.execute({
        ...executionInput(fixture),
        executorInvocationId: 'executor-invocation.3',
        credentialValues: {
          'secret.provider': 'secret-value-canary',
          'secret.unexpected': 'must-not-pass'
        }
      })
    ).rejects.toMatchObject({ code: 'unexpected_credential' })
  })
})

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'mam-codex-adapter-'))
  directories.push(root)
  const snapshot = effectiveSnapshot()
  const resources: MaterializedAttemptResources = {
    attemptId: snapshot.attemptId,
    rootDirectory: join(root, 'resources'),
    configPath: join(root, 'resources', 'effective-config.json'),
    manifestPath: join(root, 'resources', 'resource-manifest.json'),
    skillDirectories: {},
    contentHash: snapshot.contentHash
  }
  return { root, snapshot, resources }
}

function executionInput(fixture: Awaited<ReturnType<typeof createFixture>>) {
  return {
    profile: executorProfile(),
    binding: executorBinding(fixture.root),
    snapshot: fixture.snapshot,
    resources: fixture.resources,
    executorInvocationId: 'executor-invocation.1',
    workspacePath: fixture.root,
    prompt: 'Complete the task and return the required JSON result.',
    credentialValues: { 'secret.provider': 'secret-value-canary' },
    authority: {
      workflowRunId: 'run.1',
      nodeRunId: 'node-run.1',
      taskId: 'task.1',
      attemptId: 'attempt.1',
      roleInstanceId: 'role-instance.1',
      executorInvocationId: 'caller-value-is-replaced',
      effectiveConfigHash: 'b'.repeat(64),
      createdAt: '2026-07-28T04:01:00Z'
    }
  }
}

function successfulRunner(): CodexProcessRunner {
  return async (invocation) => {
    await writeFile(invocation.resultPath, JSON.stringify(agentPayload()))
    return {
      exitCode: 0,
      signal: null,
      stdout: [
        { type: 'thread.started', thread_id: 'internal-only' },
        { type: 'turn.started' },
        { type: 'item.completed', item: { type: 'agent_message', text: 'Done.' } },
        {
          type: 'turn.completed',
          usage: { input_tokens: 120, cached_input_tokens: 20, output_tokens: 30 }
        }
      ]
        .map((event) => JSON.stringify(event))
        .join('\n'),
      stderr: '',
      timedOut: false
    }
  }
}

function agentPayload() {
  return {
    schemaVersion: '1.0.0',
    status: 'submitted',
    summary: 'Structured completion.',
    verifications: [],
    risks: [],
    followUps: [],
    artifacts: [],
    usage: { status: 'known', inputTokens: 999_999, outputTokens: 999_999 }
  }
}

function executorProfile(): ExecutorProfile {
  return {
    id: 'executor.codex',
    version: 1,
    kind: 'codex-cli',
    executableRef: 'executable.codex',
    adapterOptions: { mode: 'headless' }
  }
}

function executorBinding(root: string): LocalExecutorBinding {
  return {
    id: 'binding.codex',
    executorProfileId: 'executor.codex',
    executablePath: 'codex',
    configRoot: join(root, 'executor-config'),
    bindingIdentity: 'local.machine'
  }
}

function readyPreflight(): ExecutorLocalPreflight {
  const probe: ExecutorProbe = (_executable, args) => ({
    exitCode: 0,
    stdout:
      args[0] === '--version'
        ? 'codex-cli test'
        : '--json --output-schema --ignore-user-config --ephemeral --model -c, --config',
    stderr: ''
  })
  return new ExecutorLocalPreflight(probe)
}

function effectiveSnapshot(): EffectiveRoleConfigSnapshot {
  const hash = 'a'.repeat(64)
  const ref = { id: 'profile', version: 1, contentHash: hash }
  const base = {
    schemaVersion: '1.0.0' as const,
    id: 'effective.1',
    workflowRunId: 'run.1',
    taskId: 'task.1',
    attemptId: 'attempt.1',
    roleProfile: { ...ref, id: 'role.developer' },
    executorProfile: { ...ref, id: 'executor.codex', kind: 'codex-cli' as const },
    providerProfile: { ...ref, id: 'provider.custom' },
    modelProfile: { ...ref, id: 'model.custom' },
    systemPromptRef: 'prompt.developer',
    execution: {
      executableRef: 'executable.codex',
      adapterOptions: { mode: 'headless' },
      providerProtocol: 'openai-responses' as const,
      providerBaseUrl: 'https://models.example.invalid/v1',
      providerSecretRef: 'secret.provider',
      remoteModelId: 'model-id',
      modelCapabilities: {
        modalities: ['text' as const],
        supportsTools: true,
        supportsStructuredOutput: true
      },
      inference: { reasoningEffort: 'high' }
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
      allowedNetworkHosts: ['models.example.invalid'],
      requireApprovalFor: []
    },
    budget: {
      maxInputTokens: 10_000,
      maxOutputTokens: 2_000,
      maxCostUsd: 1,
      maxDurationSeconds: 60
    },
    retry: { maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0 },
    contextPolicy: {
      maxContextTokens: 10_000,
      compaction: 'disabled' as const,
      includePreviousAttempts: false
    },
    localBindingIds: ['binding.codex', 'binding.secret.provider'],
    createdAt: '2026-07-28T04:00:00Z'
  }
  return { ...base, contentHash: profileContentHash(base) }
}
