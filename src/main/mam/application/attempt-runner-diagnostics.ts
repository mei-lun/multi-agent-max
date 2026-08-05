import type { ExecutorUsage } from '../../../shared/mam/executor-events'
import type { DiagnosticsRecorder } from '../diagnostics/diagnostics-recorder'
import type { PreparedAttempt } from './mam-attempt-execution-types'

type AttemptRunnerDiagnosticsInput = Readonly<{
  prepared: PreparedAttempt
  diagnostics: DiagnosticsRecorder
  now(): string
  onActivityChanged?(): void
}>

export function recordAttemptRunnerCost(
  input: AttemptRunnerDiagnosticsInput,
  usage: ExecutorUsage
): void {
  input.diagnostics.recordCost({
    ...diagnosticIdentity(input.prepared, input.now()),
    usage: {
      inputTokens: usage.inputTokens ?? null,
      outputTokens: usage.outputTokens ?? null,
      costUsd: usage.costUsd ?? null,
      status:
        usage.status === 'known' ? 'reported' : usage.status === 'partial' ? 'partial' : 'unknown'
    }
  })
  input.onActivityChanged?.()
}

export function recordAttemptRunnerEvent(
  input: AttemptRunnerDiagnosticsInput,
  kind: 'scheduler' | 'executor',
  payload: Readonly<Record<string, unknown>>
): void {
  input.diagnostics.record({
    ...diagnosticIdentity(input.prepared, input.now()),
    kind,
    payload
  })
  input.onActivityChanged?.()
}

export function attemptRunnerErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String(error.code)
  }
  const message = error instanceof Error ? error.message : String(error)
  const token = /^([a-z][a-z0-9]*_[a-z0-9_]+)/.exec(message)?.[1]
  return token ?? 'execution_error'
}

function diagnosticIdentity(prepared: PreparedAttempt, at: string) {
  return {
    at,
    workflowRunId: prepared.workflowRunId,
    nodeId: prepared.nodeId,
    taskId: prepared.taskId,
    attemptId: prepared.attemptId,
    roleInstanceId: prepared.roleInstanceId,
    executorInvocationId: prepared.executorInvocationId
  }
}
