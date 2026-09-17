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

export function buildTaskDeliveryCommand(
  prepared: PreparedAttempt,
  result: AttemptResult,
  commandId: string,
  issuedAt: string
): Extract<SchedulerCommand, { type: 'record_task_delivery' }> {
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
    type: 'record_task_delivery',
    claimId: prepared.claimId,
    generation: prepared.claimGeneration,
    attemptId: prepared.attemptId,
    ...(prepared.previousAttemptId
      ? { previousDeliveredAttemptId: prepared.previousAttemptId }
      : {}),
    lineageKind: prepared.previousAttemptId ? 'revision' : 'initial',
    revisionNumber: prepared.formalRevisionNumber,
    roleInstanceId: prepared.roleInstanceId,
    executorInvocationId: prepared.executorInvocationId,
    effectiveConfigSnapshotId: prepared.snapshot.id,
    effectiveConfigHash: prepared.snapshot.contentHash,
    result,
    inputDeliveries: uniqueInputDeliveries([
      ...(prepared.task.inputDeliveries ?? []),
      ...(prepared.task.inputArtifactContext ?? [])
        .filter((item) => item.source === 'workflow' && item.producerTaskId && item.producerAttemptId)
        .map((item) => ({ taskId: item.producerTaskId!, attemptId: item.producerAttemptId! }))
    ])
  }
}

function uniqueInputDeliveries(
  inputs: readonly Readonly<{ taskId: string; attemptId: string }>[]
) {
  return [...new Map(inputs.map((input) => [input.taskId, input] as const)).values()].sort((a, b) =>
    a.taskId.localeCompare(b.taskId)
  )
}
