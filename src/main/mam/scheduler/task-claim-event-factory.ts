import type { TaskClaimCommand } from './task-claim-command-authority'
import type { SchedulerKernelContext } from './scheduler-kernel-context'

export function createTaskClaimEvent(
  command: TaskClaimCommand,
  context: SchedulerKernelContext,
  base: Readonly<Record<string, unknown>>
): unknown {
  if (command.type === 'claim_task') {
    return {
      ...base,
      type: 'task_claimed',
      taskId: command.taskId,
      claim: claim(
        command.claimId,
        command.claimantInstanceId,
        (context.task?.lastClaimGeneration ?? 0) + 1,
        command,
        context
      )
    }
  }
  if (command.type === 'release_task_claim') {
    return {
      ...base,
      type: 'task_claim_released',
      taskId: command.taskId,
      claimId: command.claimId,
      generation: command.generation,
      releasedByUserId: command.actor.kind === 'user' ? command.actor.userId : ''
    }
  }
  return {
    ...base,
    type: 'task_claim_taken_over',
    taskId: command.taskId,
    previousClaimId: command.previousClaimId,
    previousGeneration: command.expectedGeneration,
    claim: claim(
      command.newClaimId,
      command.claimantInstanceId,
      command.expectedGeneration + 1,
      command,
      context
    ),
    reason: command.reason,
    takenOverByUserId: command.actor.kind === 'user' ? command.actor.userId : ''
  }
}

function claim(
  claimId: string,
  claimantInstanceId: string,
  generation: number,
  command: TaskClaimCommand,
  context: SchedulerKernelContext
) {
  return {
    schemaVersion: '1.0.0' as const,
    claimId,
    taskId: command.taskId,
    roleProfileId: context.task!.assignedRoleProfileId!,
    roleProfileVersion: context.task!.assignedRoleProfileVersion!,
    claimantInstanceId,
    generation,
    claimedAt: command.issuedAt
  }
}
