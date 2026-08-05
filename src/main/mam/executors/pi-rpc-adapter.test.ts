import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { RpcClient, type RpcClientOptions } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ExecutorProfile,
  LocalExecutorBinding
} from '../../../shared/mam/domain/execution-profile'
import type { EffectiveRoleConfigSnapshot } from '../../../shared/mam/domain/role'
import type { MaterializedAttemptResources } from '../profiles/attempt-resource-materializer'
import { profileContentHash } from '../profiles/profile-content-hash'
import { ExecutorLocalPreflight, type ExecutorProbe } from './executor-local-preflight'
import { PiRpcAdapter, type PiRpcClient } from './pi-rpc-adapter'
import type { ExecutorCapabilityBridge } from '../application/executor-capability-bridge'

const directories: string[] = []
const fakeServer = resolve('src/main/mam/executors/test-fixtures/pi-rpc-fake-server.mjs')

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('PiRpcAdapter', () => {
  it('runs the official RPC client with isolated config and retains an optional standard result', async () => {
    const fixture = await createFixture()
    const clients: RpcClient[] = []
    const adapter = new PiRpcAdapter(
      (options: RpcClientOptions) => {
        const client = new RpcClient(options)
        clients.push(client)
        return client
      },
      () => '2026-07-28T08:01:00Z',
      readyPreflight()
    )

    const execution = await adapter.execute(executionInput(fixture))

    expect(clients).toHaveLength(1)
    expect(execution.result).toMatchObject({
      status: 'submitted',
      summary: 'Pi returned a structured result.',
      usage: { status: 'known', inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
      system: {
        workflowRunId: 'run.1',
        taskId: 'task.1',
        attemptId: 'attempt.1',
        executorInvocationId: 'executor-invocation.1',
        effectiveConfigHash: fixture.snapshot.contentHash
      }
    })
    expect(execution.events.at(-1)).toMatchObject({
      type: 'invocation_completed',
      sourceEventType: 'mam.standard_result.accepted'
    })
    expect(execution.events.find((event) => event.sourceEventType === 'agent_settled')?.type).toBe(
      'tool_event'
    )
    const started = execution.events.find((event) => event.sourceEventType === 'agent_start')
    expect(started?.payload.environmentKeys).toContain('MAM_PI_PROVIDER_KEY')
    expect(started?.payload.environmentKeys).not.toContain('HOME')
    expect(started?.payload.environmentKeys).not.toContain('MAM_PI_EXECUTABLE')
    expect(execution.invocation.launchOptions.args).toContain('--no-extensions')
    expect(execution.invocation.launchOptions.args).not.toContain('--extension')
    expect(execution.invocation.launchOptions.args).toContain('--tools')
    expect(execution.invocation.launchOptions.args).toContain('read,bash,edit,write,grep,find,ls')
    expect(execution.invocation.agentDirectory).not.toBe(execution.invocation.sessionDirectory)
    expect(execution.stderr).toContain('[REDACTED]')
    expect(execution.stderr).not.toContain('mam-canary-secret')
    const models = JSON.parse(await readFile(execution.invocation.modelsPath, 'utf8'))
    expect(models.providers['provider.custom']).toMatchObject({
      api: 'openai-completions',
      apiKey: '$MAM_PI_PROVIDER_KEY'
    })
    const rpcLog = await readFile(execution.invocation.rpcLogPath, 'utf8')
    expect(rpcLog).not.toContain('mam-canary-secret')
    expect(rpcLog).toContain('[REDACTED]')
  })

  it('allows the Application layer to validate workspace outputs without a structured result', async () => {
    const fixture = await createFixture()
    const client = new ControllablePiClient(null)
    const adapter = new PiRpcAdapter(
      () => client,
      () => '2026-07-28T08:01:00Z',
      readyPreflight()
    )

    await expect(adapter.execute(executionInput(fixture))).resolves.not.toHaveProperty('result')
    expect(client.stopped).toBe(true)
  })

  it('returns direct document text for a read-only Role without retaining streaming updates', async () => {
    const fixture = await createFixture()
    fixture.snapshot = readOnlySnapshot(fixture.snapshot)
    fixture.resources = { ...fixture.resources, contentHash: fixture.snapshot.contentHash }
    const client = new StreamingPiClient('# Deliverable\n\n## summary\nDone.')
    const adapter = new PiRpcAdapter(
      () => client,
      () => '2026-07-28T08:01:00Z',
      readyPreflight()
    )

    const onEvent = vi.fn()
    const execution = await adapter.execute({ ...executionInput(fixture), onEvent })

    expect(execution.assistantText).toContain('# Deliverable')
    expect(execution.events).toHaveLength(1)
    expect(execution.events[0]?.sourceEventType).toBe('agent_settled')
    expect(onEvent).toHaveBeenCalledTimes(2_001)
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'agent_message', sourceEventType: 'message_update' })
    )
    expect(execution.invocation.launchOptions.args).toContain('--tools')
    expect(execution.invocation.launchOptions.args).toContain('read,grep,find,ls')
  })

  it('exposes steer and abort only for an active invocation', async () => {
    const fixture = await createFixture()
    const client = new ControllablePiClient(JSON.stringify(agentPayload()), false)
    const adapter = new PiRpcAdapter(
      () => client,
      () => '2026-07-28T08:01:00Z',
      readyPreflight()
    )
    const execution = adapter.execute(executionInput(fixture))
    await client.promptReceived

    await adapter.steer('executor-invocation.1', 'Tighten the result.')
    await adapter.abort('executor-invocation.1')
    client.settle()
    await expect(execution).resolves.toMatchObject({ result: { status: 'submitted' } })
    expect(client.commands).toEqual(['prompt', 'steer:Tighten the result.', 'abort'])
    await expect(adapter.abort('executor-invocation.1')).rejects.toMatchObject({
      code: 'unknown_executor_invocation'
    })
  })

  it('rejects credentials outside the Effective Config allowlist', async () => {
    const fixture = await createFixture()
    const adapter = new PiRpcAdapter(
      () => new ControllablePiClient(JSON.stringify(agentPayload())),
      () => '2026-07-28T08:01:00Z',
      readyPreflight()
    )
    await expect(
      adapter.execute({
        ...executionInput(fixture),
        credentialValues: {
          'secret.provider': 'mam-canary-secret-provider',
          'secret.unexpected': 'not-allowed'
        }
      })
    ).rejects.toMatchObject({ code: 'unexpected_credential' })
  })

  it('injects only the unified Application API tools for Role resource bindings', async () => {
    const fixture = await createFixture()
    fixture.snapshot = resourceSnapshot(fixture.snapshot)
    fixture.resources = { ...fixture.resources, contentHash: fixture.snapshot.contentHash }
    const execute = vi.fn(async () => ({ ok: true }))
    const adapter = new PiRpcAdapter(
      () => new ControllablePiClient(JSON.stringify(agentPayload())),
      () => '2026-07-28T08:01:00Z',
      readyPreflight()
    )

    const execution = await adapter.execute({
      ...executionInput(fixture),
      capabilityBridge: { execute } as unknown as ExecutorCapabilityBridge
    })

    const args = execution.invocation.launchOptions.args ?? []
    expect(args).toContain('--extension')
    expect(args).toContain('--tools')
    expect(args.join(',')).toContain('mam_mcp,mam_knowledge_search,mam_knowledge_read')
    expect(args.join(',')).not.toContain('mcp.search')
    expect(execution.invocation.launchOptions.env).toMatchObject({
      MAM_APPLICATION_API_ENDPOINT: expect.stringMatching(/^http:\/\/127\.0\.0\.1:/),
      MAM_APPLICATION_API_TOKEN: expect.any(String)
    })
    const manifest = JSON.parse(await readFile(execution.invocation.manifestPath, 'utf8'))
    expect(manifest).toMatchObject({
      mcpServerIds: ['mcp.office'],
      knowledgeBaseIds: ['knowledge.requirements'],
      extensionIds: ['mam.application-api']
    })
  })
})

class ControllablePiClient implements PiRpcClient {
  readonly commands: string[] = []
  stopped = false
  readonly promptReceived: Promise<void>
  private resolvePrompt!: () => void
  private resolveIdle!: () => void
  private readonly listeners: Array<(event: never) => void> = []

  constructor(
    private readonly result: string | null,
    private readonly settleOnPrompt = true
  ) {
    this.promptReceived = new Promise((resolvePromise) => (this.resolvePrompt = resolvePromise))
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {
    this.stopped = true
  }

  onEvent(listener: (event: never) => void): () => void {
    this.listeners.push(listener)
    return () => this.listeners.splice(this.listeners.indexOf(listener), 1)
  }

  async prompt(): Promise<void> {
    this.commands.push('prompt')
    this.resolvePrompt()
    if (this.settleOnPrompt) this.settle()
  }

  async steer(message: string): Promise<void> {
    this.commands.push(`steer:${message}`)
  }

  async abort(): Promise<void> {
    this.commands.push('abort')
  }

  waitForIdle(): Promise<void> {
    return new Promise((resolvePromise) => (this.resolveIdle = resolvePromise))
  }

  settle(): void {
    for (const listener of this.listeners) listener({ type: 'agent_settled' } as never)
    this.resolveIdle()
  }

  protected emitForTest(event: never): void {
    for (const listener of this.listeners) listener(event)
  }

  async getLastAssistantText(): Promise<string | null> {
    return this.result
  }

  async getSessionStats() {
    return sessionStats()
  }

  getStderr(): string {
    return ''
  }
}

class StreamingPiClient extends ControllablePiClient {
  override async prompt(): Promise<void> {
    for (let index = 0; index < 2_000; index += 1) {
      this.emitForTest({
        type: 'message_update',
        assistantMessageEvent: {
          type: 'text_delta',
          contentIndex: 0,
          delta: 'x',
          partial: { content: [{ thinkingSignature: 'x'.repeat(index) }] }
        }
      } as never)
    }
    await super.prompt()
  }
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'mam-pi-rpc-adapter-'))
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
    systemPrompt: 'Follow the assigned Role policy.',
    prompt: 'Complete the assigned task.',
    credentialValues: { 'secret.provider': 'mam-canary-secret-provider' },
    authority: {
      workflowRunId: 'run.1',
      nodeRunId: 'node-run.1',
      taskId: 'task.1',
      attemptId: 'attempt.1',
      roleInstanceId: 'role-instance.1',
      executorInvocationId: 'caller-value-is-replaced',
      effectiveConfigHash: 'b'.repeat(64),
      createdAt: '2026-07-28T08:01:00Z'
    }
  }
}

function executorProfile(): ExecutorProfile {
  return {
    id: 'executor.pi',
    version: 1,
    kind: 'pi-rpc',
    executableRef: 'executable.pi',
    adapterOptions: { mode: 'rpc' }
  }
}

function executorBinding(root: string): LocalExecutorBinding {
  return {
    id: 'binding.pi',
    executorProfileId: 'executor.pi',
    executablePath: fakeServer,
    configRoot: join(root, 'executor-config'),
    bindingIdentity: 'local.machine'
  }
}

function readyPreflight(): ExecutorLocalPreflight {
  const probe: ExecutorProbe = (_executable, args) => ({
    exitCode: 0,
    stdout: args[0] === '--version' ? 'pi-coding-agent 0.81.1' : '--mode rpc --json',
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
    executorProfile: { ...ref, id: 'executor.pi', kind: 'pi-rpc' as const },
    providerProfile: { ...ref, id: 'provider.custom' },
    modelProfile: { ...ref, id: 'model.custom' },
    systemPromptRef: 'prompt.developer',
    execution: {
      executableRef: 'executable.pi',
      adapterOptions: { mode: 'rpc' },
      providerProtocol: 'openai-completions' as const,
      providerBaseUrl: 'https://models.example.invalid/v1',
      providerSecretRef: 'secret.provider',
      remoteModelId: 'model-id',
      modelCapabilities: {
        modalities: ['text' as const],
        supportsTools: true,
        supportsStructuredOutput: true
      },
      inference: { thinkingLevel: 'off' }
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
      maxDurationSeconds: 5
    },
    retry: { maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0 },
    contextPolicy: {
      maxContextTokens: 10_000,
      compaction: 'disabled' as const,
      includePreviousAttempts: false
    },
    localBindingIds: ['binding.pi', 'binding.secret.provider'],
    createdAt: '2026-07-28T08:00:00Z'
  }
  return { ...base, contentHash: profileContentHash(base) }
}

function resourceSnapshot(snapshot: EffectiveRoleConfigSnapshot): EffectiveRoleConfigSnapshot {
  const { contentHash: _, ...base } = snapshot
  const resourceBase = {
    ...base,
    mcpBindings: [
      {
        serverProfileId: 'mcp.office',
        version: 1,
        contentHash: 'c'.repeat(64)
      }
    ],
    knowledgeBaseBindings: [
      {
        knowledgeBaseProfileId: 'knowledge.requirements',
        version: 1,
        contentHash: 'd'.repeat(64),
        status: 'available' as const
      }
    ],
    tools: ['mcp.search', 'knowledge.search', 'knowledge.read']
  }
  return { ...resourceBase, contentHash: profileContentHash(resourceBase) }
}

function readOnlySnapshot(snapshot: EffectiveRoleConfigSnapshot): EffectiveRoleConfigSnapshot {
  const { contentHash: _, ...base } = snapshot
  const readOnlyBase = {
    ...base,
    permissions: { ...base.permissions, writePaths: [] }
  }
  return { ...readOnlyBase, contentHash: profileContentHash(readOnlyBase) }
}

function agentPayload() {
  return {
    schemaVersion: '1.0.0',
    status: 'submitted',
    summary: 'Structured Pi completion.',
    verifications: [],
    risks: [],
    followUps: [],
    artifacts: [],
    usage: { status: 'unknown' }
  }
}

function sessionStats() {
  return {
    sessionFile: undefined,
    sessionId: 'session.1',
    userMessages: 1,
    assistantMessages: 1,
    toolCalls: 0,
    toolResults: 0,
    totalMessages: 2,
    tokens: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, total: 18 },
    cost: 0.001,
    contextUsage: { tokens: 15, contextWindow: 1000, percent: 1.5 }
  }
}
