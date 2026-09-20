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

export function effectiveReviewRevisionLimit(input: {
  reviewNodeId: string
  maxRevisionAttempts: number
  edges: readonly {
    from: string
    when?: string | undefined
    maxTraversals?: number | undefined
  }[]
}): number {
  const returnEdge = input.edges.find(
    (edge) => edge.from === input.reviewNodeId && edge.when === 'changes_requested'
  )
  return returnEdge?.maxTraversals === undefined
    ? input.maxRevisionAttempts
    : Math.min(input.maxRevisionAttempts, returnEdge.maxTraversals + 1)
}
