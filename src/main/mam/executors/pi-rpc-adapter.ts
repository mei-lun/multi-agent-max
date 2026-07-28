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
  agentAttemptResultJsonSchema,
  buildAttemptResult,
  type AttemptResultAuthority
} from '../artifacts/attempt-result-builder'
import type { MaterializedAttemptResources } from '../profiles/attempt-resource-materializer'
import { ExecutorLocalPreflight } from './executor-local-preflight'
import {
  acceptedPiResultEvent,
  normalizePiRpcEvent,
  normalizePiRpcUsage
} from './pi-rpc-event-normalizer'
import { preparePiRpcInvocation, type PiRpcInvocation } from './pi-rpc-invocation'
import { PiRpcLogWriter } from './pi-rpc-log-writer'

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
  result: AttemptResult
  stderr: string
}>

type PiClientFactory = (options: RpcClientOptions) => PiRpcClient | Promise<PiRpcClient>
type ActivePiInvocation = Readonly<{ client: PiRpcClient; logger: PiRpcLogWriter }>

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
  }): Promise<PiRpcExecutionResult> {
    this.validateExecution(input)
    const invocation = await preparePiRpcInvocation({
      ...input,
      executorBinding: input.binding
    })
    const logger = new PiRpcLogWriter(
      invocation.rpcLogPath,
      Object.values(input.credentialValues),
      this.now
    )
    const client = await this.createClient(invocation.launchOptions)
    const events: ExecutorEvent[] = []
    const unsubscribe = client.onEvent((event) => {
      void logger.append('event', event)
      events.push(
        normalizePiRpcEvent({
          event,
          executorInvocationId: input.executorInvocationId,
          timestamp: this.now()
        })
      )
    })
    this.activeInvocations.set(input.executorInvocationId, { client, logger })
    try {
      await client.start()
      const structuredPrompt = resultPrompt(input.prompt)
      await logger.append('command', { type: 'prompt', message: structuredPrompt })
      const idle = client.waitForIdle(input.snapshot.budget.maxDurationSeconds * 1000)
      await client.prompt(structuredPrompt)
      await idle
      const [resultText, stats] = await Promise.all([
        client.getLastAssistantText(),
        client.getSessionStats()
      ])
      const usage = normalizePiRpcUsage(stats)
      const payload = parseStructuredResult(resultText, usage)
      const authority = {
        ...input.authority,
        executorInvocationId: input.executorInvocationId,
        effectiveConfigHash: input.snapshot.contentHash
      }
      events.push(
        acceptedPiResultEvent({
          executorInvocationId: input.executorInvocationId,
          timestamp: this.now()
        })
      )
      await client.stop()
      const stderr = client.getStderr()
      if (stderr) await logger.append('stderr', stderr)
      return {
        invocation,
        events,
        usage,
        result: buildAttemptResult(payload, authority),
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

function resultPrompt(prompt: string): string {
  return [
    prompt,
    '',
    'Return exactly one JSON object matching this schema. Do not use Markdown fences or prose.',
    JSON.stringify(agentAttemptResultJsonSchema())
  ].join('\n')
}

function parseStructuredResult(resultText: string | null, usage: ExecutorUsage) {
  if (!resultText) {
    fail('structured_result_missing', 'Pi became idle without a standard Attempt Result')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(resultText)
  } catch (error) {
    fail('structured_result_invalid', `Pi result is not JSON: ${String(error)}`)
  }
  try {
    const payload = AgentAttemptResultPayloadSchema.parse(parsed)
    return AgentAttemptResultPayloadSchema.parse({
      ...payload,
      usage: {
        status: usage.status,
        ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
        ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
        ...(usage.costUsd === undefined ? {} : { costUsd: usage.costUsd })
      }
    })
  } catch (error) {
    fail('structured_result_invalid', `Pi result does not match the schema: ${String(error)}`)
  }
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0]?.trim() ?? ''
}

function fail(code: string, message: string): never {
  throw new PiRpcAdapterError(code, message)
}
