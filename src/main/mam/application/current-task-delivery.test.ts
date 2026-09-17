import { describe, expect, it } from 'vitest'
import type { AttemptProjection, TaskProjection } from '../state-store/git-state-projection'
import { currentTaskDeliveryAttemptId, currentTaskDeliveryIds } from './current-task-delivery'

describe('currentTaskDeliveryAttemptId', () => {
  it('uses the explicit Formal Delivery and never falls back to history order', () => {
    const attempts = {
      'attempt.current': attempt('submitted'),
      'attempt.late': attempt('submitted')
    }
    expect(currentTaskDeliveryAttemptId(task('attempt.current'), attempts)).toBe('attempt.current')
  })

  it('accepts one legacy submitted delivery but rejects ambiguity', () => {
    expect(currentTaskDeliveryAttemptId(task(), { one: attempt('submitted') })).toBe('one')
    expect(
      currentTaskDeliveryAttemptId(task(), { one: attempt('submitted'), two: attempt('submitted') })
    ).toBeUndefined()
  })
})

describe('currentTaskDeliveryIds', () => {
  it('includes selected reused and unique legacy Deliveries', () => {
    const attempts = {
      reused: { status: 'submitted' },
      legacy: { status: 'submitted' }
    }
    expect(
      Object.fromEntries(
        currentTaskDeliveryIds({
          tasks: {
            reuse: { selectedAttemptId: 'reused', knownAttemptIds: ['reused'] },
            old: { knownAttemptIds: ['legacy'] }
          } as never,
          attempts: attempts as never
        })
      )
    ).toEqual({ reuse: 'reused', old: 'legacy' })
  })
})

function task(currentDeliveryAttemptId?: string): TaskProjection {
  return {
    status: 'submitted',
    activeAttemptIds: [],
    knownAttemptIds: ['one', 'two'],
    reviewIds: [],
    executionWarnings: [],
    ...(currentDeliveryAttemptId ? { currentDeliveryAttemptId } : {}),
    lastEventId: 'event.1'
  }
}

function attempt(status: AttemptProjection['status']): AttemptProjection {
  return { taskId: 'task.1', status, lastEventId: 'event.1' }
}
