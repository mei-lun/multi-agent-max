import { describe, expect, it } from 'vitest'
import {
  accumulatedDraftRuntime,
  remainingPreparedAttemptRuntimeMs
} from './prepared-attempt-draft'

describe('remainingPreparedAttemptRuntimeMs', () => {
  it('uses the Draft cumulative active runtime across resumed invocations', () => {
    const store = { get: () => ({ activeRuntimeMs: 59_000 }) }
    const prepared = {
      draftId: 'draft.1',
      snapshot: { budget: { maxDurationSeconds: 60 } }
    }
    expect(remainingPreparedAttemptRuntimeMs(store as never, prepared as never)).toBe(1_000)
  })

  it('adds the active interval when a running Draft is paused', () => {
    expect(
      accumulatedDraftRuntime(
        {
          activeRuntimeMs: 10_000,
          activeStartedAt: '2026-09-17T10:00:00Z'
        } as never,
        '2026-09-17T10:00:05Z'
      )
    ).toBe(15_000)
  })

  it('defaults continuation attempts for older Draft records', () => {
    const store = { get: () => ({ activeRuntimeMs: 0 }) }
    const prepared = {
      draftId: 'draft.1',
      snapshot: { budget: { maxDurationSeconds: 60 } }
    }
    expect(remainingPreparedAttemptRuntimeMs(store as never, prepared as never)).toBe(60_000)
  })
})
