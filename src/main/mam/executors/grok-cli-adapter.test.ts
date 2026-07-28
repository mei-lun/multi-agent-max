import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  ExecutorProfile,
  LocalExecutorBinding
} from '../../../shared/mam/domain/execution-profile'
import type { EffectiveRoleConfigSnapshot } from '../../../shared/mam/domain/role'
import type { MaterializedAttemptResources } from '../profiles/attempt-resource-materializer'
import { profileContentHash } from '../profiles/profile-content-hash'
import type { GrokAcpNotification, GrokAcpTransport } from './grok-acp-protocol'
import { GrokAcpStdioTransport } from './grok-acp-transport'
import { GrokCliAdapter } from './grok-cli-adapter'
import { ExecutorLocalPreflight, type ExecutorProbe } from './executor-local-preflight'

const directories: string[] = []
const fakeServer = resolve('src/main/mam/executors/test-fixtures/grok-acp-fake-server.mjs')

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('GrokCliAdapter', () => {
  it('translates verified ACP stdio into isolated events and a standard Attempt Result', async () => {
    const fixture = await createFixture()
    const adapter = new GrokCliAdapter(
      (invocation) =>
        new GrokAcpStdioTransport({
          command: process.execPath,
          args: [fakeServer],
          cwd: invocation.cwd,
          env: invocation.env,
          secrets: invocation.secrets
        }),
      () => '2026-07-28T09:01:00Z',
      readyPreflight()
    )

    const execution = await adapter.execute(executionInput(fixture))

    expect(execution.result).toMatchObject({
      status: 'submitted',
      summary: 'Grok returned a structured result.',
      usage: { status: 'partial', inputTokens: 12, outputTokens: 8, costUsd: 0.002 },
      system: {
        workflowRunId: 'run.grok',
        attemptId: 'attempt.grok',
        executorInvocationId: 'executor-invocation.grok'
      }
    })
    expect(execution.events.at(-1)).toMatchObject({
      type: 'invocation_completed',
      sourceEventType: 'mam.standard_result.accepted'
    })
    expect(execution.events.find((event) => event.sourceEventType === 'session/idle')?.type).toBe(
      'tool_event'
    )
    const environment = execution.events.find(
      (event) => event.sourceEventType === 'vendor/environment'
    )
    expect(execution.events.map((event) => event.sourceEventType)).toContain('vendor/environment')
    expect(environment?.payload.environmentKeys).toContain('GROK_HOME')
    expect(environment?.payload.environmentKeys).not.toContain('HOME')
    expect(environment?.payload.apiKey).toBe('[REDACTED]')
    expect(execution.invocation.args).toEqual([
      '--deny',
      'agent',
      '--deny',
      'subagent',
      'agent',
      '--model',
      'grok-test-model',
      '--no-leader',
      'stdio'
    ])
    expect(execution.stderr).toContain('[REDACTED]')
    expect(execution.stderr).not.toContain('mam-canary-secret')
    const config = await readFile(execution.invocation.configPath, 'utf8')
    expect(config).toContain('api_backend = "chat_completions"')
    expect(config).toContain('env_key = "MAM_GROK_PROVIDER_KEY"')
  })

  it('does not treat an ACP stop reason or idle notification as completion', async () => {
    const fixture = await createFixture()
    const transport = new ResultlessTransport()
    const adapter = new GrokCliAdapter(
      () => transport,
      () => '2026-07-28T09:01:00Z',
      readyPreflight()
    )
    await expect(adapter.execute(executionInput(fixture))).rejects.toMatchObject({
      code: 'structured_result_missing'
    })
    expect(transport.stopped).toBe(true)
  })

  it('stops before launch when the installed Grok CLI has no verified ACP interface', async () => {
    const fixture = await createFixture()
    let transportCreated = false
    const adapter = new GrokCliAdapter(
      () => {
        transportCreated = true
        return new ResultlessTransport()
      },
      () => '2026-07-28T09:01:00Z',
      new ExecutorLocalPreflight(() => ({
        exitCode: 0,
        stdout: 'Interactive terminal only',
        stderr: ''
      }))
    )
    await expect(adapter.execute(executionInput(fixture))).rejects.toMatchObject({
      code: 'structured_interface_unavailable'
    })
    expect(transportCreated).toBe(false)
  })
})

class ResultlessTransport implements GrokAcpTransport {
  stopped = false
  private readonly listeners = new Set<(notification: GrokAcpNotification) => void>()

  async start(): Promise<void> {}

  async stop(): Promise<void> {
    this.stopped = true
  }

  async request(method: string): Promise<Record<string, unknown>> {
    if (method === 'session/new') return { sessionId: 'internal-session' }
    if (method === 'session/prompt') {
      this.emit({ jsonrpc: '2.0', method: 'session/idle', params: { message: 'done' } })
      return { stopReason: 'end_turn' }
    }
    return {}
  }

  async notify(): Promise<void> {}

  onNotification(listener: (notification: GrokAcpNotification) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onExit(): () => void {
    return () => undefined
  }

  getStderr(): string {
    return ''
  }

  private emit(notification: GrokAcpNotification): void {
    for (const listener of this.listeners) listener(notification)
  }
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'mam-grok-adapter-'))
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
    executorInvocationId: 'executor-invocation.grok',
    workspacePath: fixture.root,
    systemPrompt: 'Follow the assigned Role policy.',
    prompt: 'Complete the assigned task.',
    credentialValues: { 'secret.provider': 'mam-canary-secret-grok' },
    authority: {
      workflowRunId: 'run.grok',
      nodeRunId: 'node-run.grok',
      taskId: 'task.grok',
      attemptId: 'attempt.grok',
      roleInstanceId: 'role-instance.grok',
      executorInvocationId: 'replaced',
      effectiveConfigHash: 'b'.repeat(64),
      createdAt: '2026-07-28T09:01:00Z'
    }
  }
}

function executorProfile(): ExecutorProfile {
  return {
    id: 'executor.grok',
    version: 1,
    kind: 'grok-cli',
    executableRef: 'executable.grok',
    adapterOptions: { mode: 'acp' }
  }
}

function executorBinding(root: string): LocalExecutorBinding {
  return {
    id: 'binding.grok',
    executorProfileId: 'executor.grok',
    executablePath: 'grok',
    configRoot: join(root, 'executor-config'),
    bindingIdentity: 'local.machine'
  }
}

function readyPreflight(): ExecutorLocalPreflight {
  const probe: ExecutorProbe = (_executable, args) => ({
    exitCode: 0,
    stdout: args[0] === '--version' ? 'grok 0.2.110' : 'stdio --model <model> --no-leader',
    stderr: ''
  })
  return new ExecutorLocalPreflight(probe)
}

function effectiveSnapshot(): EffectiveRoleConfigSnapshot {
  const hash = 'a'.repeat(64)
  const ref = { id: 'profile', version: 1, contentHash: hash }
  const base = {
    schemaVersion: '1.0.0' as const,
    id: 'effective.grok',
    workflowRunId: 'run.grok',
    taskId: 'task.grok',
    attemptId: 'attempt.grok',
    roleProfile: { ...ref, id: 'role.developer' },
    executorProfile: { ...ref, id: 'executor.grok', kind: 'grok-cli' as const },
    providerProfile: { ...ref, id: 'provider.custom' },
    modelProfile: { ...ref, id: 'model.custom' },
    systemPromptRef: 'prompt.developer',
    execution: {
      executableRef: 'executable.grok',
      adapterOptions: { mode: 'acp' },
      providerProtocol: 'openai-completions' as const,
      providerBaseUrl: 'https://models.example.invalid/v1',
      providerSecretRef: 'secret.provider',
      remoteModelId: 'grok-test-model',
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
      allowedNetworkHosts: ['models.example.invalid'],
      requireApprovalFor: []
    },
    budget: {
      maxInputTokens: 10_000,
      maxOutputTokens: 2_000,
      maxCostUsd: 1,
      maxDurationSeconds: 10
    },
    retry: { maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0 },
    contextPolicy: {
      maxContextTokens: 10_000,
      compaction: 'disabled' as const,
      includePreviousAttempts: false
    },
    localBindingIds: ['binding.grok', 'binding.secret.provider'],
    createdAt: '2026-07-28T09:00:00Z'
  }
  return { ...base, contentHash: profileContentHash(base) }
}
