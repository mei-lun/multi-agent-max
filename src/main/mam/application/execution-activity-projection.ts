import type { MamUiExecutionActivity, MamUiRunSnapshot } from '../../../shared/mam/ui-projection'
import type { DiagnosticEvent } from '../diagnostics/diagnostics-recorder'

const MAX_RUN_ACTIVITIES = 500
const MAX_DETAIL_LENGTH = 2_000

export function projectExecutionActivities(
  workflowRunId: string,
  events: readonly DiagnosticEvent[],
  attempts: MamUiRunSnapshot['attempts']
): MamUiExecutionActivity[] {
  const attemptByRole = new Map(
    attempts.flatMap((attempt) =>
      attempt.roleInstanceId ? [[attempt.roleInstanceId, attempt] as const] : []
    )
  )
  return events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.workflowRunId === workflowRunId)
    .slice(-MAX_RUN_ACTIVITIES)
    .flatMap(({ event, index }) => {
      const presentation = activityPresentation(event)
      if (!presentation) return []
      const attempt = attemptByRole.get(event.roleInstanceId)
      return [
        {
          id: `activity.${index}`,
          at: event.at,
          nodeId: event.nodeId,
          roleInstanceId: event.roleInstanceId,
          executorInvocationId: event.executorInvocationId,
          ...((event.taskId ?? attempt?.taskId) ? { taskId: event.taskId ?? attempt!.taskId } : {}),
          ...((event.attemptId ?? attempt?.id)
            ? { attemptId: event.attemptId ?? attempt!.id }
            : {}),
          ...presentation
        }
      ]
    })
}

type ActivityPresentation = Pick<
  MamUiExecutionActivity,
  'category' | 'title' | 'detail' | 'sourceEventType'
>

function activityPresentation(event: DiagnosticEvent): ActivityPresentation | undefined {
  if (event.kind === 'cost') {
    return { category: 'usage', title: 'Usage updated', detail: usageDetail(event.payload) }
  }
  const executorEvent = recordValue(event.payload.event)
  if (executorEvent) return executorPresentation(executorEvent)
  const status = stringValue(event.payload.status)
  const message = stringValue(event.payload.message)
  if (!status && !message) return undefined
  return {
    category: status?.includes('fail') || status?.includes('interrupt') ? 'error' : 'status',
    title: status ? humanize(status) : 'Status update',
    ...(message ? { detail: limit(message) } : {})
  }
}

function executorPresentation(event: Record<string, unknown>): ActivityPresentation | undefined {
  const type = stringValue(event.type)
  const sourceEventType = stringValue(event.sourceEventType)
  const payload = recordValue(event.payload) ?? {}
  const detail = extractDetail(payload)
  if (type === 'agent_message') {
    return detail ? present('message', 'Agent message', detail, sourceEventType) : undefined
  }
  if (type === 'usage_updated') {
    return present('usage', 'Usage updated', detail, sourceEventType)
  }
  if (type === 'invocation_failed') {
    return present('error', 'Execution failed', detail, sourceEventType)
  }
  if (type === 'invocation_started' || type === 'invocation_completed') {
    return present(
      'status',
      type === 'invocation_started' ? 'Execution started' : 'Execution completed',
      detail,
      sourceEventType
    )
  }
  const command = commandEvent(sourceEventType)
    ? findString(payload, ['command', 'cmd', 'executable', 'shell_command'])
    : undefined
  if (!command && !detail) return undefined
  return present(
    command ? 'command' : 'tool',
    command ? 'Command' : 'Tool activity',
    command ?? detail,
    sourceEventType
  )
}

function commandEvent(sourceEventType: string | undefined): boolean {
  return !sourceEventType || /(?:start|started)$/.test(sourceEventType)
}

function present(
  category: MamUiExecutionActivity['category'],
  title: string,
  detail?: string,
  sourceEventType?: string
): ActivityPresentation {
  return {
    category,
    title,
    ...(detail ? { detail: limit(detail) } : {}),
    ...(sourceEventType ? { sourceEventType: limit(sourceEventType, 160) } : {})
  }
}

function extractDetail(payload: Record<string, unknown>): string | undefined {
  const direct = findString(payload, [
    'textDelta',
    'delta',
    'text',
    'message',
    'output',
    'command',
    'cmd',
    'toolName',
    'name'
  ])
  return direct ? limit(direct) : undefined
}

function findString(value: unknown, keys: readonly string[], depth = 0): string | undefined {
  if (depth > 5 || !value || typeof value !== 'object') return undefined
  const record = recordValue(value)
  if (!record) return undefined
  for (const key of keys) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  for (const child of Object.values(record)) {
    const candidate = findString(child, keys, depth + 1)
    if (candidate) return candidate
  }
  return undefined
}

function usageDetail(payload: Readonly<Record<string, unknown>>): string | undefined {
  const usage = recordValue(payload.usage)
  if (!usage) return undefined
  const parts = [
    numberLabel(usage.inputTokens, 'input'),
    numberLabel(usage.outputTokens, 'output'),
    typeof usage.costUsd === 'number' ? `$${usage.costUsd.toFixed(4)}` : undefined
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

function numberLabel(value: unknown, suffix: string): string | undefined {
  return typeof value === 'number' ? `${value.toLocaleString('en-US')} ${suffix}` : undefined
}

function humanize(value: string): string {
  const words = value.replaceAll('_', ' ')
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}

function limit(value: string, max = MAX_DETAIL_LENGTH): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
