import type { PreparedAttempt } from './mam-attempt-execution-types'

export function preparedAttemptResultAuthority(prepared: PreparedAttempt, createdAt: string) {
  return {
    workflowRunId: prepared.workflowRunId,
    nodeRunId: prepared.task.nodeRunId,
    taskId: prepared.taskId,
    attemptId: prepared.attemptId,
    roleInstanceId: prepared.roleInstanceId,
    executorInvocationId: prepared.executorInvocationId,
    effectiveConfigHash: prepared.snapshot.contentHash,
    createdAt
  }
}

export function preparedAttemptGatewayAuthority(prepared: PreparedAttempt) {
  return {
    workflowRunId: prepared.workflowRunId,
    nodeRunId: prepared.task.nodeRunId,
    taskId: prepared.taskId,
    attemptId: prepared.attemptId,
    roleInstanceId: prepared.roleInstanceId,
    executorInvocationId: prepared.executorInvocationId,
    effectiveConfigHash: prepared.snapshot.contentHash
  }
}
