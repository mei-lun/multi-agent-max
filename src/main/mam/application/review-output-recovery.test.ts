import { describe, expect, it, vi } from 'vitest'
import type { PreparedAttempt } from './mam-attempt-execution-types'
import { recoveredReviewExecution } from './review-output-recovery'

describe('Review output recovery', () => {
  it('returns a local execution result without calling an Executor', async () => {
    const execute = vi.fn()
    const prepared = {
      task: { reviewTask: { id: 'review-task.one' } },
      recoveredAssistantText: '审核通过，交付符合要求。'
    } as unknown as PreparedAttempt

    const recovered = recoveredReviewExecution(prepared)
    if (!recovered) await execute()

    expect(recovered).toMatchObject({
      usage: { status: 'unknown' },
      assistantText: '审核通过，交付符合要求。',
      events: []
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('does not recover a non-Review Task from assistant text', () => {
    expect(
      recoveredReviewExecution({
        task: {},
        recoveredAssistantText: 'Done.'
      } as unknown as PreparedAttempt)
    ).toBeUndefined()
  })
})
