import { describe, expect, it } from 'vitest'
import { applyAttemptResultSubmitted } from './attempt-result-event-application'

describe('Attempt Result event application', () => {
  it('retires the old Review panel when a concurrent result becomes selected', () => {
    const tasks = {
      'task.source': {
        status: 'in_review' as const,
        activeAttemptIds: ['attempt.new'],
        knownAttemptIds: ['attempt.old', 'attempt.new'],
        selectedAttemptId: 'attempt.old',
        reviewIds: ['review.old'],
        reviewPanelId: 'review-gate.attempt.old',
        executionWarnings: [],
        lastEventId: 'event.review.old'
      }
    }
    const attempts = {
      'attempt.new': {
        taskId: 'task.source',
        status: 'running' as const,
        lastEventId: 'event.start.new'
      }
    }
    const reviews = {
      'review.old': {
        id: 'review.old',
        subject: { taskId: 'task.source', attemptId: 'attempt.old' }
      }
    }
    const reviewValidity = { 'review.old': { status: 'valid' as const } }

    applyAttemptResultSubmitted({
      event: {
        eventId: 'event.result.new',
        createdAt: '2026-09-14T09:00:00Z',
        taskId: 'task.source',
        attemptId: 'attempt.new',
        result: { status: 'submitted', system: {} }
      } as never,
      tasks,
      attempts,
      reviews: reviews as never,
      reviewValidity,
      mergeQueueEntries: {}
    })

    expect(tasks['task.source']).toMatchObject({
      status: 'submitted',
      selectedAttemptId: 'attempt.new'
    })
    expect(tasks['task.source']).not.toHaveProperty('reviewPanelId')
    expect(reviewValidity['review.old']).toEqual({
      status: 'invalidated',
      invalidatedByAttemptId: 'attempt.new'
    })
  })
})
