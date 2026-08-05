import { describe, expect, it } from 'vitest'
import { boundedReviewStatus } from './review-revision-limit'

describe('Review revision limit', () => {
  it('blocks a change request at the configured Attempt limit', () => {
    expect(
      boundedReviewStatus({
        status: 'changes_requested',
        attemptCount: 2,
        maxRevisionAttempts: 2
      })
    ).toBe('blocked')
  })

  it('preserves approved and still-available revisions', () => {
    expect(
      boundedReviewStatus({ status: 'approved', attemptCount: 2, maxRevisionAttempts: 2 })
    ).toBe('approved')
    expect(
      boundedReviewStatus({
        status: 'changes_requested',
        attemptCount: 1,
        maxRevisionAttempts: 2
      })
    ).toBe('changes_requested')
  })
})
