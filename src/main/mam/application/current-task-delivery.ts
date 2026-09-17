import type { AttemptProjection, TaskProjection } from '../state-store/git-state-projection'

export function currentTaskDeliveryAttemptId(
  task: TaskProjection | undefined,
  attempts: Readonly<Record<string, AttemptProjection>>
): string | undefined {
  if (!task) return undefined
  if (task.currentDeliveryAttemptId) {
    return attempts[task.currentDeliveryAttemptId]?.status === 'submitted'
      ? task.currentDeliveryAttemptId
      : undefined
  }
  if (task.selectedAttemptId && attempts[task.selectedAttemptId]?.status === 'submitted') {
    return task.selectedAttemptId
  }
  const legacyCandidates = task.knownAttemptIds.filter(
    (attemptId) => attempts[attemptId]?.status === 'submitted'
  )
  return legacyCandidates.length === 1 ? legacyCandidates[0] : undefined
}

export function requireCurrentTaskDeliveryAttemptId(
  task: TaskProjection | undefined,
  attempts: Readonly<Record<string, AttemptProjection>>
): string {
  const attemptId = currentTaskDeliveryAttemptId(task, attempts)
  if (!attemptId) throw new Error('current_task_delivery_unavailable')
  return attemptId
}

export function currentTaskDeliveryIds(input: {
  tasks: Readonly<Record<string, TaskProjection>>
  attempts: Readonly<Record<string, AttemptProjection>>
}): ReadonlyMap<string, string> {
  return new Map(
    Object.entries(input.tasks).flatMap(([taskId, task]) => {
      const attemptId = currentTaskDeliveryAttemptId(task, input.attempts)
      return attemptId ? [[taskId, attemptId] as const] : []
    })
  )
}
