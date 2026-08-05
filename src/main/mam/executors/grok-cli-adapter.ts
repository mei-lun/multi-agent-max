import type {
  ExecutorProfile,
  LocalExecutorBinding
} from '../../../shared/mam/domain/execution-profile'
import type { AttemptResult } from '../../../shared/mam/domain/attempt-result'
import type { EffectiveRoleConfigSnapshot } from '../../../shared/mam/domain/role'
import {
  ExecutorEventSchema,
  ExecutorUsageSchema,
  type ExecutorEvent,
  type ExecutorUsage
} from '../../../shared/mam/executor-events'
import {
  AgentAttemptResultPayloadSchema,
  agentAttemptResultJsonSchema,
  buildAttemptResult,
  type AttemptResultAuthority
} from '../artifacts/attempt-result-builder'
import type { MaterializedAttemptResources } from '../profiles/attempt-resource-materializer'
import type { GrokAcpNotification, GrokAcpTransport } from './grok-acp-protocol'
import { GrokAcpStdioTransport } from './grok-acp-transport'
import { prepareGrokCliInvocation, type GrokCliInvocation } from './grok-cli-invocation'
import { ExecutorLocalPreflight } from './executor-local-preflight'
import { emitObservedExecutorEvent, type ExecutorEventListener } from './executor-event-listener'

export type GrokCliExecutionResult = Readonly<{
  invocation: GrokCliInvocation
  events: readonly ExecutorEvent[]
  usage: ExecutorUsage
  result: AttemptResult
  stderr: string
}>

type GrokTransportFactory = (invocation: GrokCliInvocation) => GrokAcpTransport
type ActiveGrokInvocation = Readonly<{ transport: GrokAcpTransport; sessionId: string }>

export class GrokCliAdapterError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'GrokCliAdapterError'
  }
}

export class GrokCliAdapter {
  private readonly activeInvocations = new Map<string, ActiveGrokInvocation>()

  constructor(
    private readonly createTransport: GrokTransportFactory = (invocation) =>
      new GrokAcpStdioTransport({
        command: invocation.command,
        args: invocation.args,
        cwd: invocation.cwd,
        env: invocation.env,
        secrets: invocation.secrets,
        requestTimeoutMs: invocation.requestTimeoutMs
      }),
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
    onEvent?: ExecutorEventListener
  }): Promise<GrokCliExecutionResult> {
    this.validateExecution(input)
    const invocation = await prepareGrokCliInvocation({
      ...input,
      executorBinding: input.binding
    })
    const transport = this.createTransport(invocation)
    const events: ExecutorEvent[] = []
    let resultText = ''
    const unsubscribe = transport.onNotification((notification) => {
      const event = normalizeNotification(notification, input.executorInvocationId, this.now())
      events.push(event)
      emitObservedExecutorEvent(input.onEvent, event)
      resultText += extractAgentText(notification)
    })
    let sessionId: string | undefined
    try {
      await transport.start()
      await transport.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
        clientInfo: { name: 'multi-agent-max', version: '0.1.0' }
      })
      const session = await transport.request('session/new', {
        cwd: invocation.cwd,
        mcpServers: [],
        _meta: { modelId: input.snapshot.execution.remoteModelId }
      })
      sessionId = stringValue(session.sessionId)
      if (!sessionId) fail('acp_session_missing', 'Grok ACP did not return an internal session ID')
      this.activeInvocations.set(input.executorInvocationId, { transport, sessionId })
      const response = await transport.request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: resultPrompt(input) }]
      })
      const usage = extractUsage(response)
      const payload = parseStructuredResult(resultText, usage)
      const authority = {
        ...input.authority,
        executorInvocationId: input.executorInvocationId,
        effectiveConfigHash: input.snapshot.contentHash
      }
      const completedEvent = acceptedResultEvent(input.executorInvocationId, this.now())
      events.push(completedEvent)
      emitObservedExecutorEvent(input.onEvent, completedEvent)
      await transport.stop()
      return {
        invocation,
        events,
        usage,
        result: buildAttemptResult(payload, authority),
        stderr: transport.getStderr()
      }
    } catch (error) {
      await transport.stop().catch(() => undefined)
      if (error instanceof GrokCliAdapterError) throw error
      const message = error instanceof Error ? error.message : String(error)
      if (/timeout/i.test(message)) fail('executor_timeout', message)
      fail(
        'executor_process_failed',
        `${message}${transport.getStderr() ? `; ${firstLine(transport.getStderr())}` : ''}`
      )
    } finally {
      this.activeInvocations.delete(input.executorInvocationId)
      unsubscribe()
      await transport.stop().catch(() => undefined)
    }
  }

  async abort(executorInvocationId: string): Promise<void> {
    const active = this.activeInvocations.get(executorInvocationId)
    if (!active) fail('unknown_executor_invocation', 'Grok Executor invocation is not active')
    await active.transport.notify('session/cancel', { sessionId: active.sessionId })
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
    if (input.profile.kind !== 'grok-cli') {
      fail('adapter_kind_mismatch', 'GrokCliAdapter requires a grok-cli Executor Profile')
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
      fail('executor_invocation_active', 'Grok Executor invocation is already active')
    }
  }
}

function normalizeNotification(
  notification: GrokAcpNotification,
  executorInvocationId: string,
  timestamp: string
): ExecutorEvent {
  return ExecutorEventSchema.parse({
    schemaVersion: '1.0.0',
    type: extractAgentText(notification) ? 'agent_message' : 'tool_event',
    timestamp,
    executorKind: 'grok-cli',
    executorInvocationId,
    sourceEventType: notification.method,
    payload: redactValue(notification.params ?? {})
  })
}

function extractAgentText(notification: GrokAcpNotification): string {
  if (notification.method !== 'session/update') return ''
  const update = recordValue(notification.params?.update)
  if (update?.sessionUpdate !== 'agent_message_chunk') return ''
  const content = recordValue(update.content)
  return content?.type === 'text' && typeof content.text === 'string' ? content.text : ''
}

function extractUsage(response: Record<string, unknown>): ExecutorUsage {
  const usage = recordValue(response.usage) ?? recordValue(recordValue(response._meta)?.usage)
  if (!usage) return { status: 'unknown' }
  const inputTokens = tokenValue(usage.inputTokens ?? usage.input_tokens)
  const outputTokens = tokenValue(usage.outputTokens ?? usage.output_tokens)
  const costUsd = costValue(usage.costUsd ?? usage.cost_usd)
  return ExecutorUsageSchema.parse({
    status:
      inputTokens === undefined && outputTokens === undefined && costUsd === undefined
        ? 'unknown'
        : 'partial',
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(costUsd === undefined ? {} : { costUsd })
  })
}

function parseStructuredResult(resultText: string, usage: ExecutorUsage) {
  if (!resultText) fail('structured_result_missing', 'Grok returned no standard Attempt Result')
  let parsed: unknown
  try {
    parsed = JSON.parse(resultText)
  } catch (error) {
    fail('structured_result_invalid', `Grok result is not JSON: ${String(error)}`)
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
    fail('structured_result_invalid', `Grok result does not match the schema: ${String(error)}`)
  }
}

function resultPrompt(input: { systemPrompt: string; prompt: string }): string {
  return [
    input.systemPrompt,
    '',
    input.prompt,
    '',
    'Return exactly one JSON object matching this schema. Do not use Markdown fences or prose.',
    JSON.stringify(agentAttemptResultJsonSchema())
  ].join('\n')
}

function acceptedResultEvent(executorInvocationId: string, timestamp: string): ExecutorEvent {
  return ExecutorEventSchema.parse({
    schemaVersion: '1.0.0',
    type: 'invocation_completed',
    timestamp,
    executorKind: 'grok-cli',
    executorInvocationId,
    sourceEventType: 'mam.standard_result.accepted',
    payload: {}
  })
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
      .replace(/mam-canary-secret-[A-Za-z0-9_-]+/g, '[REDACTED]')
  }
  if (Array.isArray(value)) return value.map(redactValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      /^(?:api[_-]?key|token|authorization|cookie|password|secret|credentials?)$/i.test(key)
        ? '[REDACTED]'
        : redactValue(item)
    ])
  )
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function tokenValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function costValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0]?.trim() ?? ''
}

function fail(code: string, message: string): never {
  throw new GrokCliAdapterError(code, message)
}
