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
  const activities: MamUiExecutionActivity[] = []
  let mergeableMessageIndex: number | undefined
  events.forEach((event, index) => {
    if (event.workflowRunId !== workflowRunId) return
    const presentation = activityPresentation(event)
    if (!presentation) {
      if (!isUnpresentedStreamingUpdate(event)) mergeableMessageIndex = undefined
      return
    }
    const attempt = attemptByRole.get(event.roleInstanceId)
    const activity: MamUiExecutionActivity = {
      id: `activity.${index}`,
      at: event.at,
      nodeId: event.nodeId,
      roleInstanceId: event.roleInstanceId,
      executorInvocationId: event.executorInvocationId,
      ...((event.taskId ?? attempt?.taskId) ? { taskId: event.taskId ?? attempt!.taskId } : {}),
      ...((event.attemptId ?? attempt?.id) ? { attemptId: event.attemptId ?? attempt!.id } : {}),
      ...presentation
    }
    if (activity.category === 'message') {
      const previous =
        mergeableMessageIndex === undefined ? undefined : activities[mergeableMessageIndex]
      if (previous && sameMessageContext(previous, activity)) {
        activities[mergeableMessageIndex!] = {
          ...previous,
          detail: limit(`${previous.detail ?? ''}${activity.detail ?? ''}`)
        }
        return
      }
      activities.push(activity)
      mergeableMessageIndex = activities.length - 1
      return
    }
    activities.push(activity)
    mergeableMessageIndex = undefined
  })
  return activities.slice(-MAX_RUN_ACTIVITIES)
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
    if (sourceEventType?.startsWith('message_update') && !isTextMessagePayload(payload)) {
      return undefined
    }
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

function isTextMessagePayload(payload: Record<string, unknown>): boolean {
  if (typeof payload.textDelta === 'string') return true
  const update = findRecord(payload, 'assistantMessageEvent')
  return update?.type === 'text_delta'
}

function findRecord(value: unknown, key: string, depth = 0): Record<string, unknown> | undefined {
  if (depth > 5 || !value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const candidate = recordValue(record[key])
  if (candidate) return candidate
  for (const child of Object.values(record)) {
    const found = findRecord(child, key, depth + 1)
    if (found) return found
  }
  return undefined
}

function isUnpresentedStreamingUpdate(event: DiagnosticEvent): boolean {
  const executorEvent = recordValue(event.payload.event)
  return (
    stringValue(executorEvent?.type) === 'agent_message' &&
    stringValue(executorEvent?.sourceEventType)?.startsWith('message_update') === true
  )
}

function sameMessageContext(left: MamUiExecutionActivity, right: MamUiExecutionActivity): boolean {
  return (
    left.nodeId === right.nodeId &&
    left.attemptId === right.attemptId &&
    left.executorInvocationId === right.executorInvocationId
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
  const delta = findUntrimmedString(payload, ['textDelta', 'delta'])
  if (delta) return limit(delta)
  const direct = findString(payload, [
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

function findUntrimmedString(
  value: unknown,
  keys: readonly string[],
  depth = 0
): string | undefined {
  if (depth > 5 || !value || typeof value !== 'object') return undefined
  const record = recordValue(value)
  if (!record) return undefined
  for (const key of keys) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate
  }
  for (const child of Object.values(record)) {
    const candidate = findUntrimmedString(child, keys, depth + 1)
    if (candidate !== undefined) return candidate
  }
  return undefined
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
