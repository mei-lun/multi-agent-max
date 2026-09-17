import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import type { SchedulerKernelContext, SchedulerTaskContext } from './scheduler-kernel-context'
import { SchedulerCommandRejectedError } from './scheduler-command-rejection'
import { assertReviewDecisionBinding } from './review-command-authority'

export type TaskDeliveryCommand = Extract<SchedulerCommand, { type: 'record_task_delivery' }>

export function assertTaskDeliveryAuthority(
  command: TaskDeliveryCommand,
  task: SchedulerTaskContext,
  context: SchedulerKernelContext
): void {
  const claim = task.activeClaim
  if (!claim || claim.claimId !== command.claimId || claim.generation !== command.generation) {
    reject('stale_claim', 'Task Claim generation is no longer active')
  }
  if (command.actor.kind !== 'executor') {
    reject('executor_authority_required', 'Task Delivery requires an Executor actor')
  }
  if (task.status !== 'ready' && task.status !== 'changes_requested') {
    reject('task_not_deliverable', `Task cannot deliver from ${task.status}`)
  }
  const expectedLineage = task.selectedAttemptId ? 'revision' : 'initial'
  if (command.lineageKind !== expectedLineage) {
    reject('delivery_lineage_invalid', 'Task Delivery lineage kind does not match current state')
  }
  if (
    (task.selectedAttemptId ?? undefined) !== (command.previousDeliveredAttemptId ?? undefined) ||
    command.revisionNumber !== (task.formalRevisionNumber ?? 0) + (task.selectedAttemptId ? 1 : 0)
  ) {
    reject('delivery_lineage_invalid', 'Task Delivery does not extend the current delivery')
  }
  const system = command.result.system
  if (
    command.actor.attemptId !== command.attemptId ||
    command.actor.roleInstanceId !== command.roleInstanceId ||
    command.actor.executorInvocationId !== command.executorInvocationId ||
    system.workflowRunId !== command.workflowRunId ||
    system.taskId !== command.taskId ||
    system.attemptId !== command.attemptId ||
    system.roleInstanceId !== command.roleInstanceId ||
    system.executorInvocationId !== command.executorInvocationId ||
    system.effectiveConfigHash !== command.effectiveConfigHash
  ) {
    reject('result_binding_mismatch', 'Task Delivery authority fields do not match its Result')
  }
  const invalidArtifact = command.result.artifacts.find(
    (artifact) => !context.validArtifactHashes.has(artifact.sha256)
  )
  if (invalidArtifact) reject('invalid_artifact', 'Task Delivery references an invalid Artifact')
  assertReviewDecisionBinding({
    review: command.review,
    workflowRunId: command.workflowRunId,
    reviewerTaskId: command.taskId,
    reviewerAttemptId: command.attemptId,
    reviewerRoleInstanceId: command.roleInstanceId,
    reviewTarget: task.reviewTarget,
    reviewNodeId: task.reviewNodeId
  })
  const actualInputTaskIds = command.inputDeliveries.map((input) => input.taskId)
  if (new Set(actualInputTaskIds).size !== actualInputTaskIds.length) {
    reject('input_lineage_invalid', 'Task Delivery contains duplicate upstream Tasks')
  }
  if (
    [...(task.requiredInputTaskIds ?? [])].some(
      (taskId) => !actualInputTaskIds.includes(taskId)
    )
  ) {
    reject('input_lineage_incomplete', 'Task Delivery omits a required upstream Delivery')
  }
  if (
    command.inputDeliveries.some(
      (input) => context.taskCurrentDeliveryIds?.get(input.taskId) !== input.attemptId
    )
  ) {
    reject('stale_input_lineage', 'Task Delivery was produced from a superseded upstream Delivery')
  }
}

function reject(code: string, message: string): never {
  throw new SchedulerCommandRejectedError(code, message)
}
