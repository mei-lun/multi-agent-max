import type { PreparedAttempt } from './mam-attempt-execution-types'

export function schedulerEnvelope(
  prepared: PreparedAttempt,
  commandId: string,
  issuedAt: string,
  schedulerId: string
) {
  return {
    schemaVersion: '1.0.0' as const,
    commandId,
    issuedAt,
    workflowRunId: prepared.workflowRunId,
    taskId: prepared.taskId,
    actor: { kind: 'scheduler' as const, schedulerId }
  }
}
