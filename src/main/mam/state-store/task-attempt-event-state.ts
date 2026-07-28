import type { SchedulerEvent } from '../../../shared/mam/scheduler-protocol'
import { GitEventApplicationError } from './git-event-application-error'
import type { AttemptProjection, TaskProjection } from './git-state-projection'

export function requireProjectedTask(
  tasks: Record<string, TaskProjection>,
  taskId: string
): TaskProjection {
  return (
    tasks[taskId] ?? failGitEventApplication('task_not_assigned', `task ${taskId} is not assigned`)
  )
}

export function requireProjectedAttempt(
  attempts: Record<string, AttemptProjection>,
  attemptId: string,
  taskId: string
): AttemptProjection {
  const attempt = attempts[attemptId]
  if (!attempt || attempt.taskId !== taskId) {
    failGitEventApplication('attempt_not_found', 'attempt is not bound to task')
  }
  return attempt
}

export function updateProjectedTask<T extends Partial<TaskProjection>>(
  task: TaskProjection,
  event: SchedulerEvent,
  patch: T
): TaskProjection {
  return { ...task, ...patch, lastEventId: event.eventId }
}

export function uniqueIds(values: readonly string[]): string[] {
  return [...new Set(values)]
}

export function failGitEventApplication(code: string, message: string): never {
  throw new GitEventApplicationError(code, message)
}
