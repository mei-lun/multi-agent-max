import { describe, expect, it } from 'vitest'
import { boundedReviewStatus, effectiveReviewRevisionLimit } from './review-revision-limit'

describe('Review revision limit', () => {
  it('blocks a change request after the configured revision limit', () => {
    expect(
      boundedReviewStatus({
        status: 'changes_requested',
        revisionCount: 2,
        maxRevisionAttempts: 2
      })
    ).toBe('blocked')
  })

  it('preserves approved and still-available revisions', () => {
    expect(
      boundedReviewStatus({ status: 'approved', revisionCount: 2, maxRevisionAttempts: 2 })
    ).toBe('approved')
    expect(
      boundedReviewStatus({
        status: 'changes_requested',
        revisionCount: 1,
        maxRevisionAttempts: 2
      })
    ).toBe('changes_requested')
  })

  it('uses the same revision count for the Review node and return edge', () => {
    expect(
      effectiveReviewRevisionLimit({
        reviewNodeId: 'review',
        maxRevisionAttempts: 3,
        edges: [{ from: 'review', when: 'changes_requested', maxTraversals: 2 }]
      })
    ).toBe(2)
  })
})
