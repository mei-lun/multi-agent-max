import type { SessionStats } from '@earendil-works/pi-coding-agent'
import {
  ExecutorEventSchema,
  ExecutorUsageSchema,
  type ExecutorEvent,
  type ExecutorUsage
} from '../../../shared/mam/executor-events'

export function normalizePiRpcEvent(input: {
  event: unknown
  executorInvocationId: string
  timestamp: string
}): ExecutorEvent {
  const event = asRecord(compactPiRpcEvent(input.event))
  const sourceEventType = typeof event.type === 'string' ? event.type : 'unknown'
  const { type: _type, ...payload } = event
  return ExecutorEventSchema.parse({
    schemaVersion: '1.0.0',
    type: normalizedEventType(sourceEventType),
    timestamp: input.timestamp,
    executorKind: 'pi-rpc',
    executorInvocationId: input.executorInvocationId,
    sourceEventType,
    payload: redactPiRpcValue(payload)
  })
}

/**
 * Pi repeats the complete assistant message in every streaming update. Keep
 * only the delta and small lifecycle metadata so one response cannot make
 * diagnostics grow quadratically.
 */
export function compactPiRpcEvent(value: unknown): unknown {
  const event = asRecord(value)
  const type = typeof event.type === 'string' ? event.type : ''
  if (type === 'message_update') {
    const update = asRecord(event.assistantMessageEvent)
    return {
      type,
      assistantMessageEvent: {
        type: update.type,
        contentIndex: update.contentIndex,
        ...(typeof update.delta === 'string' ? { delta: update.delta } : {})
      }
    }
  }
  if (type === 'message_start' || type === 'message_end') {
    const message = asRecord(event.message)
    return {
      type,
      message: {
        role: message.role,
        contentTypes: Array.isArray(message.content)
          ? message.content.map((item) => asRecord(item).type).filter(Boolean)
          : []
      }
    }
  }
  if (type === 'turn_end') {
    return { type }
  }
  if (type === 'agent_end') {
    const messages = Array.isArray(event.messages) ? event.messages : []
    return { type, messageCount: messages.length }
  }
  return value
}

export function normalizePiRpcUsage(stats: SessionStats): ExecutorUsage {
  const inputTokens = finiteToken(stats.tokens.input)
  const cachedInputTokens = finiteToken(stats.tokens.cacheRead)
  const outputTokens = finiteToken(stats.tokens.output)
  const costUsd = finiteCost(stats.cost)
  return ExecutorUsageSchema.parse({
    status:
      inputTokens === undefined && outputTokens === undefined && costUsd === undefined
        ? 'unknown'
        : 'known',
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(costUsd === undefined ? {} : { costUsd })
  })
}

export function acceptedPiResultEvent(input: {
  executorInvocationId: string
  timestamp: string
}): ExecutorEvent {
  return ExecutorEventSchema.parse({
    schemaVersion: '1.0.0',
    type: 'invocation_completed',
    timestamp: input.timestamp,
    executorKind: 'pi-rpc',
    executorInvocationId: input.executorInvocationId,
    sourceEventType: 'mam.standard_result.accepted',
    payload: {}
  })
}

export function redactPiRpcValue(value: unknown, secrets: readonly string[] = []): unknown {
  return redact(value, new WeakSet(), secrets.filter(Boolean))
}

function normalizedEventType(sourceType: string): ExecutorEvent['type'] {
  if (sourceType === 'agent_start' || sourceType === 'turn_start') return 'invocation_started'
  if (sourceType.startsWith('message_')) return 'agent_message'
  if (sourceType.includes('usage')) return 'usage_updated'
  return 'tool_event'
}

const SENSITIVE_KEY =
  /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|authorization|cookie|password|secret|credential(?:s|path)?)$/i
const TOKEN_SHAPE = /\b(?:sk|xai|api)-[A-Za-z0-9_-]{8,}\b/g
const BEARER_SHAPE = /Bearer\s+[^\s"']+/gi
const CANARY_SHAPE = /mam-canary-secret-[A-Za-z0-9_-]+/g

function redact(value: unknown, seen: WeakSet<object>, secrets: readonly string[]): unknown {
  if (typeof value === 'string') {
    let redacted = value
      .replace(BEARER_SHAPE, 'Bearer [REDACTED]')
      .replace(TOKEN_SHAPE, '[REDACTED]')
      .replace(CANARY_SHAPE, '[REDACTED]')
    for (const secret of secrets) redacted = redacted.replaceAll(secret, '[REDACTED]')
    return redacted
  }
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  if (Array.isArray(value)) return value.map((item) => redact(item, seen, secrets))
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(item, seen, secrets)
    ])
  )
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value }
}

function finiteToken(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function finiteCost(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}
