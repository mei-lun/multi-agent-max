export function boundedReviewStatus(input: {
  status: 'approved' | 'changes_requested' | 'blocked'
  attemptCount: number
  maxRevisionAttempts: number
}): 'approved' | 'changes_requested' | 'blocked' {
  if (input.status === 'changes_requested' && input.attemptCount >= input.maxRevisionAttempts) {
    return 'blocked'
  }
  return input.status
}
