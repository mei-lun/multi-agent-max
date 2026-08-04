import type { AttemptProjection, TaskProjection } from './git-state-projection'

export function blockUnconsumedRecoveryPlans(input: {
  task: TaskProjection
  attempts: Record<string, AttemptProjection>
  eventId: string
}): void {
  for (const attemptId of input.task.knownAttemptIds) {
    const attempt = input.attempts[attemptId]
    if (attempt?.status !== 'recovery_planned') continue
    input.attempts[attemptId] = {
      ...attempt,
      status: 'blocked',
      lastEventId: input.eventId
    }
  }
}
