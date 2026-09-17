import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import type { SchedulerTaskContext } from './scheduler-kernel-context'
import { SchedulerCommandRejectedError } from './scheduler-command-rejection'

export type TaskClaimCommand = Extract<
  SchedulerCommand,
  { type: 'claim_task' | 'release_task_claim' | 'force_takeover_task' }
>

export function isTaskClaimCommand(command: SchedulerCommand): command is TaskClaimCommand {
  return (
    command.type === 'claim_task' ||
    command.type === 'release_task_claim' ||
    command.type === 'force_takeover_task'
  )
}

export function assertTaskClaimAuthority(
  command: TaskClaimCommand,
  task: SchedulerTaskContext,
  schedulerId: string
): void {
  if (command.type === 'claim_task') {
    if (command.actor.kind !== 'scheduler' || command.actor.schedulerId !== schedulerId) {
      reject('scheduler_authority_required', 'Task Claim requires the active Scheduler identity')
    }
    if (!task.assignedRoleProfileId || !task.assignedRoleProfileVersion) {
      reject('assignment_required', 'Task Claim requires the Workflow-fixed Role assignment')
    }
    if (task.activeClaim) reject('task_already_claimed', 'Task already has an active Claim')
    if (task.status !== 'ready' && task.status !== 'changes_requested') {
      reject('task_not_claimable', `Task cannot be claimed from ${task.status}`)
    }
    return
  }
  if (command.actor.kind !== 'user') {
    reject('user_authority_required', 'Claim release and takeover require a user command')
  }
  const active = task.activeClaim
  if (!active) reject('task_not_claimed', 'Task has no active Claim')
  const claimId = command.type === 'release_task_claim' ? command.claimId : command.previousClaimId
  const generation =
    command.type === 'release_task_claim' ? command.generation : command.expectedGeneration
  if (active.claimId !== claimId || active.generation !== generation) {
    reject('stale_claim', 'Task Claim generation is no longer active')
  }
}

function reject(code: string, message: string): never {
  throw new SchedulerCommandRejectedError(code, message)
}
