import type { TaskDeliveryCommand } from './task-delivery-command-authority'

export function createTaskDeliveryEvent(
  command: TaskDeliveryCommand,
  base: Readonly<Record<string, unknown>>
): unknown {
  return {
    ...base,
    type: 'task_delivery_recorded',
    taskId: command.taskId,
    claimId: command.claimId,
    generation: command.generation,
    attemptId: command.attemptId,
    ...(command.previousDeliveredAttemptId
      ? { previousDeliveredAttemptId: command.previousDeliveredAttemptId }
      : {}),
    lineageKind: command.lineageKind,
    revisionNumber: command.revisionNumber,
    roleInstanceId: command.roleInstanceId,
    executorInvocationId: command.executorInvocationId,
    effectiveConfigSnapshotId: command.effectiveConfigSnapshotId,
    effectiveConfigHash: command.effectiveConfigHash,
    result: command.result,
    inputDeliveries: command.inputDeliveries,
    ...(command.review ? { review: command.review } : {})
  }
}
