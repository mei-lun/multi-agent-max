import type { AttemptResult } from '../../../shared/mam/domain/attempt-result'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import type { PreparedAttempt } from './mam-attempt-execution-types'

export function buildAttemptResultCommand(
  prepared: PreparedAttempt,
  result: AttemptResult,
  commandId: string,
  issuedAt: string
): Extract<SchedulerCommand, { type: 'submit_attempt_result' }> {
  return {
    schemaVersion: '1.0.0',
    commandId,
    issuedAt,
    workflowRunId: prepared.workflowRunId,
    taskId: prepared.taskId,
    actor: {
      kind: 'executor',
      roleInstanceId: prepared.roleInstanceId,
      attemptId: prepared.attemptId,
      executorInvocationId: prepared.executorInvocationId
    },
    type: 'submit_attempt_result',
    attemptId: prepared.attemptId,
    result
  }
}
