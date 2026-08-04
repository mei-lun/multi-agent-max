import type { WorkflowRunProjection } from '../state-store/git-state-projection'

export type AttemptStartIdentity = Readonly<{
  attemptId: string
  previousAttemptId?: string
}>

export function resolveAttemptStartIdentity(input: {
  projection: WorkflowRunProjection
  taskId: string
  taskStatus: string
  createAttemptId(): string
}): AttemptStartIdentity {
  const task = input.projection.tasks[input.taskId]
  const plannedAttemptIds = (task?.knownAttemptIds ?? []).filter(
    (attemptId) => input.projection.attempts[attemptId]?.status === 'recovery_planned'
  )
  if (plannedAttemptIds.length > 1) throw new Error('multiple_recovery_plans')
  const plannedAttemptId = plannedAttemptIds[0]
  if (plannedAttemptId) {
    const planned = input.projection.attempts[plannedAttemptId]!
    return {
      attemptId: plannedAttemptId,
      ...(planned.previousAttemptId ? { previousAttemptId: planned.previousAttemptId } : {})
    }
  }
  const selectedAttemptId = task?.selectedAttemptId
  const previousAttemptId =
    selectedAttemptId && input.projection.attempts[selectedAttemptId]?.status === 'submitted'
      ? selectedAttemptId
      : [...(task?.knownAttemptIds ?? [])]
          .reverse()
          .find((attemptId) => input.projection.attempts[attemptId]?.status === 'submitted')
  return {
    attemptId: input.createAttemptId(),
    ...(input.taskStatus === 'changes_requested' && previousAttemptId ? { previousAttemptId } : {})
  }
}
