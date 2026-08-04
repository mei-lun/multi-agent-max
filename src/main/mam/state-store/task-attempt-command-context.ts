import type { AttemptBinding } from '../scheduler/scheduler-command-authority'
import type { TaskProjection, WorkflowRunProjection } from './git-state-projection'

export function projectTaskAttemptCommandContext(
  task: TaskProjection | undefined,
  attempts: WorkflowRunProjection['attempts']
) {
  const attemptBindings = new Map<string, AttemptBinding>()
  for (const attemptId of task?.knownAttemptIds ?? []) {
    const attempt = attempts[attemptId]
    if (attempt?.roleInstanceId && attempt.executorInvocationId && attempt.effectiveConfigHash) {
      attemptBindings.set(attemptId, {
        roleInstanceId: attempt.roleInstanceId,
        executorInvocationId: attempt.executorInvocationId,
        effectiveConfigHash: attempt.effectiveConfigHash
      })
    }
  }
  return {
    activeAttemptIds: new Set(task?.activeAttemptIds ?? []),
    reconcilingAttemptIds: new Set(
      (task?.knownAttemptIds ?? []).filter(
        (attemptId) => attempts[attemptId]?.status === 'needs_reconciliation'
      )
    ),
    knownAttemptIds: new Set(task?.knownAttemptIds ?? []),
    submittedAttemptIds: new Set(
      (task?.knownAttemptIds ?? []).filter(
        (attemptId) => attempts[attemptId]?.status === 'submitted'
      )
    ),
    attemptBindings
  }
}
