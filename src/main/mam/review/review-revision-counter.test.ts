import { describe, expect, it } from 'vitest'
import type { AttemptProjection } from '../state-store/git-state-projection'
import { countFormalRevisions } from './review-revision-counter'

describe('countFormalRevisions', () => {
  it('does not count timeout-only Attempts before the first delivery', () => {
    const attempts = {
      'attempt.timeout-1': attempt('needs_reconciliation'),
      'attempt.timeout-2': attempt('blocked', 'attempt.timeout-1'),
      'attempt.delivered': attempt('submitted', 'attempt.timeout-2')
    }

    expect(countFormalRevisions({ attemptId: 'attempt.delivered', attempts })).toBe(0)
  })

  it('counts submitted ancestors as formal Review revisions', () => {
    const attempts = {
      'attempt.initial': attempt('submitted'),
      'attempt.revision-1': attempt('submitted', 'attempt.initial'),
      'attempt.revision-2': attempt('submitted', 'attempt.revision-1')
    }

    expect(countFormalRevisions({ attemptId: 'attempt.revision-2', attempts })).toBe(2)
  })

  it('stops safely when legacy lineage contains a cycle', () => {
    const attempts = {
      'attempt.a': attempt('submitted', 'attempt.b'),
      'attempt.b': attempt('submitted', 'attempt.a')
    }

    expect(countFormalRevisions({ attemptId: 'attempt.a', attempts })).toBe(1)
  })
})

function attempt(
  status: AttemptProjection['status'],
  previousAttemptId?: string
): AttemptProjection {
  return {
    taskId: 'task.1',
    status,
    ...(previousAttemptId ? { previousAttemptId } : {}),
    lastEventId: `event.${status}`
  }
}
