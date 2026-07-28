import {
  ExecutorEventSchema,
  ExecutorUsageSchema,
  type ExecutorEvent,
  type ExecutorUsage
} from '../../../shared/mam/executor-events'

export type ParsedCodexJsonl = Readonly<{
  events: readonly ExecutorEvent[]
  usage: ExecutorUsage
  completed: boolean
  errors: readonly string[]
}>

export function parseCodexJsonl(input: {
  source: string
  executorInvocationId: string
  timestamp: string
}): ParsedCodexJsonl {
  const events: ExecutorEvent[] = []
  const errors: string[] = []
  let completed = false
  let usage: ExecutorUsage = { status: 'unknown' }
  for (const [index, line] of input.source.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    let raw: Record<string, unknown>
    try {
      const parsed = JSON.parse(line)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('not object')
      raw = parsed as Record<string, unknown>
    } catch (error) {
      errors.push(`line ${index + 1}: ${String(error)}`)
      continue
    }
    const sourceEventType = typeof raw.type === 'string' ? raw.type : 'unknown'
    if (sourceEventType === 'turn.completed') {
      completed = true
      usage = extractUsage(raw)
    }
    if (sourceEventType === 'error' || sourceEventType.endsWith('.failed')) {
      errors.push(extractError(raw))
    }
    events.push(
      ExecutorEventSchema.parse({
        schemaVersion: '1.0.0',
        type: eventType(sourceEventType),
        timestamp: input.timestamp,
        executorKind: 'codex-cli',
        executorInvocationId: input.executorInvocationId,
        sourceEventType,
        payload: raw
      })
    )
  }
  return { events, usage, completed, errors }
}

function eventType(sourceType: string): ExecutorEvent['type'] {
  if (sourceType === 'thread.started' || sourceType === 'turn.started') return 'invocation_started'
  if (sourceType === 'turn.completed') return 'invocation_completed'
  if (sourceType === 'error' || sourceType.endsWith('.failed')) return 'invocation_failed'
  if (sourceType.includes('message')) return 'agent_message'
  if (sourceType.includes('usage')) return 'usage_updated'
  return 'tool_event'
}

function extractUsage(raw: Record<string, unknown>): ExecutorUsage {
  const source = objectValue(raw.usage) ?? objectValue(objectValue(raw.turn)?.usage)
  if (!source) return { status: 'unknown' }
  const inputTokens = numberValue(source.input_tokens ?? source.inputTokens)
  const cachedInputTokens = numberValue(source.cached_input_tokens ?? source.cachedInputTokens)
  const outputTokens = numberValue(source.output_tokens ?? source.outputTokens)
  return ExecutorUsageSchema.parse({
    status: inputTokens === undefined && outputTokens === undefined ? 'unknown' : 'partial',
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens })
  })
}

function extractError(raw: Record<string, unknown>): string {
  const error = objectValue(raw.error)
  const message = error?.message ?? raw.message
  return typeof message === 'string' ? message : JSON.stringify(raw)
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}
