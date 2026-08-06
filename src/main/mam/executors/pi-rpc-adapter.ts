import type {
  AgentSessionEvent,
  RpcClientOptions,
  SessionStats
} from '@earendil-works/pi-coding-agent'
import { RpcClient } from '@earendil-works/pi-coding-agent'
import type {
  ExecutorProfile,
  LocalExecutorBinding
} from '../../../shared/mam/domain/execution-profile'
import type { AttemptResult } from '../../../shared/mam/domain/attempt-result'
import type { EffectiveRoleConfigSnapshot } from '../../../shared/mam/domain/role'
import type { ExecutorEvent, ExecutorUsage } from '../../../shared/mam/executor-events'
import {
  AgentAttemptResultPayloadSchema,
  buildAttemptResult,
  type AttemptResultAuthority
} from '../artifacts/attempt-result-builder'
import type { MaterializedAttemptResources } from '../profiles/attempt-resource-materializer'
import { ExecutorLocalPreflight } from './executor-local-preflight'
import { normalizePiRpcEvent, normalizePiRpcUsage } from './pi-rpc-event-normalizer'
import { preparePiRpcInvocation, type PiRpcInvocation } from './pi-rpc-invocation'
import { PiRpcLogWriter } from './pi-rpc-log-writer'
import type { ExecutorCapabilityBridge } from '../application/executor-capability-bridge'
import { startPiApplicationApiBridge } from './pi-application-api-bridge-server'
import { emitObservedExecutorEvent, type ExecutorEventListener } from './executor-event-listener'

export type PiRpcClient = Readonly<{
  start(): Promise<void>
  stop(): Promise<void>
  onEvent(listener: (event: AgentSessionEvent) => void): () => void
  prompt(message: string): Promise<void>
  steer(message: string): Promise<void>
  abort(): Promise<void>
  waitForIdle(timeout?: number): Promise<void>
  getLastAssistantText(): Promise<string | null>
  getSessionStats(): Promise<SessionStats>
  getStderr(): string
}>

export type PiRpcExecutionResult = Readonly<{
  invocation: PiRpcInvocation
  events: readonly ExecutorEvent[]
  usage: ExecutorUsage
  result?: AttemptResult
  assistantText?: string | null
  stderr: string
}>

type PiClientFactory = (options: RpcClientOptions) => PiRpcClient | Promise<PiRpcClient>
type ActivePiInvocation = Readonly<{ client: PiRpcClient; logger: PiRpcLogWriter }>

function eventType(event: unknown): string | undefined {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return undefined
  const type = (event as { type?: unknown }).type
  return typeof type === 'string' ? type : undefined
}

export class PiRpcAdapterError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'PiRpcAdapterError'
  }
}

export class PiRpcAdapter {
  private readonly activeInvocations = new Map<string, ActivePiInvocation>()

  constructor(
    private readonly createClient: PiClientFactory = (options) => new RpcClient(options),
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly preflight = new ExecutorLocalPreflight()
  ) {}

  async execute(input: {
    profile: ExecutorProfile
    binding: LocalExecutorBinding
    snapshot: EffectiveRoleConfigSnapshot
    resources: MaterializedAttemptResources
    executorInvocationId: string
    workspacePath: string
    systemPrompt: string
    prompt: string
    credentialValues: Readonly<Record<string, string>>
    authority: AttemptResultAuthority
    capabilityBridge?: ExecutorCapabilityBridge
    onEvent?: ExecutorEventListener
  }): Promise<PiRpcExecutionResult> {
    this.validateExecution(input)
    const hasResourceBindings =
      input.snapshot.mcpBindings.length > 0 || input.snapshot.knowledgeBaseBindings.length > 0
    if (hasResourceBindings && !input.capabilityBridge) {
      fail('application_api_bridge_unavailable', 'Pi resource bindings require the Application API')
    }
    const applicationApi = input.capabilityBridge
      ? await startPiApplicationApiBridge(input.capabilityBridge)
      : undefined
    try {
      const invocation = await preparePiRpcInvocation({
        ...input,
        executorBinding: input.binding,
        ...(applicationApi ? { applicationApi } : {})
      })
      const logger = new PiRpcLogWriter(
        invocation.rpcLogPath,
        Object.values(input.credentialValues),
        this.now
      )
      const client = await this.createClient(invocation.launchOptions)
      const events: ExecutorEvent[] = []
      const unsubscribe = client.onEvent((event) => {
        void logger.append('event', event).catch(() => undefined)
        const normalized = normalizePiRpcEvent({
          event,
          executorInvocationId: input.executorInvocationId,
          timestamp: this.now()
        })
        emitObservedExecutorEvent(input.onEvent, normalized)
        if (eventType(event) !== 'message_update') events.push(normalized)
      })
      this.activeInvocations.set(input.executorInvocationId, { client, logger })
      try {
        await client.start()
        const workPrompt = workspacePrompt(
          input.prompt,
          input.snapshot.permissions.writePaths.length > 0
        )
        await logger.append('command', { type: 'prompt', message: workPrompt })
        const idle = client.waitForIdle(input.snapshot.budget.maxDurationSeconds * 1000)
        await client.prompt(workPrompt)
        await idle
        const [resultText, stats] = await Promise.all([
          client.getLastAssistantText(),
          client.getSessionStats()
        ])
        const usage = normalizePiRpcUsage(stats)
        const result = tryParseStructuredResult(resultText, usage, {
          ...input.authority,
          executorInvocationId: input.executorInvocationId,
          effectiveConfigHash: input.snapshot.contentHash
        })
        if (result) {
          const completedEvent: ExecutorEvent = {
            schemaVersion: '1.0.0',
            type: 'invocation_completed',
            timestamp: this.now(),
            executorKind: 'pi-rpc',
            executorInvocationId: input.executorInvocationId,
            sourceEventType: 'mam.standard_result.accepted',
            payload: {}
          }
          events.push(completedEvent)
          emitObservedExecutorEvent(input.onEvent, completedEvent)
        }
        await client.stop()
        const stderr = client.getStderr()
        if (stderr) await logger.append('stderr', stderr)
        return {
          invocation,
          events,
          usage,
          ...(result ? { result } : {}),
          ...(resultText ? { assistantText: resultText } : {}),
          stderr
        }
      } catch (error) {
        await client.stop().catch(() => undefined)
        const stderr = client.getStderr()
        if (stderr) await logger.append('stderr', stderr)
        if (error instanceof PiRpcAdapterError) throw error
        const message = error instanceof Error ? error.message : String(error)
        if (/timeout/i.test(message)) fail('executor_timeout', message)
        fail('executor_process_failed', `${message}${stderr ? `; ${firstLine(stderr)}` : ''}`)
      } finally {
        this.activeInvocations.delete(input.executorInvocationId)
        unsubscribe()
        await client.stop().catch(() => undefined)
        await logger.flush()
      }
    } finally {
      await applicationApi?.dispose()
    }
    fail('executor_process_failed', 'Pi execution ended without a standard result')
  }

  async steer(executorInvocationId: string, message: string): Promise<void> {
    const active = this.getActive(executorInvocationId)
    await active.logger.append('command', { type: 'steer', message })
    await active.client.steer(message)
  }

  async abort(executorInvocationId: string): Promise<void> {
    const active = this.getActive(executorInvocationId)
    await active.logger.append('command', { type: 'abort' })
    await active.client.abort()
  }

  private validateExecution(input: {
    profile: ExecutorProfile
    binding: LocalExecutorBinding
    snapshot: EffectiveRoleConfigSnapshot
    authority: AttemptResultAuthority
    executorInvocationId: string
  }): void {
    const preflight = this.preflight.check(input.profile, input.binding)
    if (!preflight.ok) {
      fail(
        preflight.issues[0]?.code ?? 'preflight_failed',
        preflight.issues.map((issue) => issue.message).join('; ')
      )
    }
    if (input.profile.kind !== 'pi-rpc') {
      fail('adapter_kind_mismatch', 'PiRpcAdapter requires a pi-rpc Executor Profile')
    }
    if (
      input.profile.id !== input.snapshot.executorProfile.id ||
      input.profile.version !== input.snapshot.executorProfile.version
    ) {
      fail('executor_profile_mismatch', 'Executor Profile does not match the Effective Config')
    }
    if (
      input.authority.workflowRunId !== input.snapshot.workflowRunId ||
      input.authority.taskId !== input.snapshot.taskId ||
      input.authority.attemptId !== input.snapshot.attemptId
    ) {
      fail('result_authority_mismatch', 'Attempt Result authority targets another Effective Config')
    }
    if (this.activeInvocations.has(input.executorInvocationId)) {
      fail('executor_invocation_active', 'Pi Executor invocation is already active')
    }
  }

  private getActive(executorInvocationId: string): ActivePiInvocation {
    const active = this.activeInvocations.get(executorInvocationId)
    if (!active) fail('unknown_executor_invocation', 'Pi Executor invocation is not active')
    return active
  }
}

function workspacePrompt(prompt: string, canWriteWorkspace: boolean): string {
  const completionInstruction = canWriteWorkspace
    ? [
        'Use the enabled tools to complete the Task in the workspace.',
        'Do not describe shell commands as chat text; execute them with the available tools.',
        'MAM validates the workspace outputs and creates its internal completion record after you finish.'
      ]
    : [
        'This Role has no workspace write access.',
        'For a document, report, or other textual output, return the complete deliverable directly as your final response.',
        'Be concise: cover every required contract before adding optional detail, and do not repeat the Task description.',
        'Do not claim that unavailable tools prevented completion and do not describe commands as chat text.'
      ]
  return [prompt, '', ...completionInstruction].join('\n')
}

function tryParseStructuredResult(
  resultText: string | null,
  usage: ExecutorUsage,
  authority: AttemptResultAuthority
): AttemptResult | undefined {
  if (!resultText) return undefined
  try {
    const parsed = AgentAttemptResultPayloadSchema.parse(JSON.parse(resultText))
    return buildAttemptResult(
      {
        ...parsed,
        usage: {
          status: usage.status,
          ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
          ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
          ...(usage.costUsd === undefined ? {} : { costUsd: usage.costUsd })
        }
      },
      authority
    )
  } catch {
    return undefined
  }
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0]?.trim() ?? ''
}

function fail(code: string, message: string): never {
  throw new PiRpcAdapterError(code, message)
}
