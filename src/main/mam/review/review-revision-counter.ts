import type { AttemptProjection } from '../state-store/git-state-projection'

export function countFormalRevisions(input: {
  attemptId: string
  attempts: Readonly<Record<string, AttemptProjection>>
}): number {
  const visited = new Set<string>([input.attemptId])
  let previousAttemptId = input.attempts[input.attemptId]?.previousAttemptId
  let count = 0
  while (previousAttemptId && !visited.has(previousAttemptId)) {
    visited.add(previousAttemptId)
    const previous = input.attempts[previousAttemptId]
    if (!previous) break
    if (previous.status === 'submitted') count += 1
    previousAttemptId = previous.previousAttemptId
  }
  return count
}

export function nextFormalRevisionNumber(
  previousAttemptId: string | undefined,
  attempts: Readonly<Record<string, AttemptProjection>>
): number {
  return previousAttemptId
    ? countFormalRevisions({ attemptId: previousAttemptId, attempts }) + 1
    : 0
}
