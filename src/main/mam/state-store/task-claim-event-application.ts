import type { SchedulerEvent } from '../../../shared/mam/scheduler-protocol'
import type { TaskProjection } from './git-state-projection'
import { failGitEventApplication, requireProjectedTask } from './task-attempt-event-state'

type TaskClaimEvent = Extract<
  SchedulerEvent,
  { type: 'task_claimed' | 'task_claim_released' | 'task_claim_taken_over' }
>

export function applyTaskClaimEvent(input: {
  event: TaskClaimEvent
  tasks: Record<string, TaskProjection>
}): void {
  const task = requireProjectedTask(input.tasks, input.event.taskId)
  if (input.event.type === 'task_claimed') {
    if (task.activeClaim) fail('task_already_claimed', 'Task already has an active Claim')
    input.tasks[input.event.taskId] = {
      ...task,
      activeClaim: input.event.claim,
      lastClaimGeneration: input.event.claim.generation,
      lastEventId: input.event.eventId
    }
    return
  }
  const active = task.activeClaim
  const claimId =
    input.event.type === 'task_claim_released' ? input.event.claimId : input.event.previousClaimId
  const generation =
    input.event.type === 'task_claim_released'
      ? input.event.generation
      : input.event.previousGeneration
  if (!active || active.claimId !== claimId || active.generation !== generation) {
    fail('stale_claim', 'Task Claim generation is no longer active')
  }
  const { activeClaim: _activeClaim, ...releasedTask } = task
  input.tasks[input.event.taskId] =
    input.event.type === 'task_claim_taken_over'
      ? {
          ...releasedTask,
          activeClaim: input.event.claim,
          lastClaimGeneration: input.event.claim.generation,
          lastEventId: input.event.eventId
        }
      : { ...releasedTask, lastClaimGeneration: generation, lastEventId: input.event.eventId }
}

function fail(code: string, message: string): never {
  return failGitEventApplication(code, message)
}
