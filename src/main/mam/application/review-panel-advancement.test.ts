import { describe, expect, it } from 'vitest'
import { latestReviewPanelSource } from './review-panel-advancement'

describe('Review panel advancement', () => {
  it('keeps chained Review gates bound to the original submitted Task', () => {
    expect(
      latestReviewPanelSource(
        {
          reviewTasks: {
            'task.architect-review': {
              subject: { taskId: 'task.develop' }
            }
          }
        } as never,
        'task.architect-review',
        'review.architect'
      )
    ).toEqual({ taskId: 'task.develop', nodeId: 'review.architect' })
  })
})
