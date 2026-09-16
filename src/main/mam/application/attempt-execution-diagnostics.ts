import type { DiagnosticsRecorder } from '../diagnostics/diagnostics-recorder'
import type { PreparedAttempt } from './mam-attempt-execution-types'

export function recordAttemptExecutionState(input: {
  diagnostics: DiagnosticsRecorder
  prepared: PreparedAttempt
  kind: 'scheduler' | 'executor'
  payload: Readonly<Record<string, unknown>>
  at: string
}): void {
  input.diagnostics.record({
    at: input.at,
    workflowRunId: input.prepared.workflowRunId,
    nodeId: input.prepared.nodeId,
    roleInstanceId: input.prepared.roleInstanceId,
    executorInvocationId: input.prepared.executorInvocationId,
    kind: input.kind,
    payload: input.payload
  })
}
