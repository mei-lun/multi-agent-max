import { describe, expect, it } from 'vitest'
import { mamUiRunFixture } from './mam-renderer-snapshot-fixture'
import {
  countMamRunRecords,
  filterMamRunRecords,
  mamRunRecordView,
  preferredMamRunRecordView
} from './mam-run-record-filter'

describe('MAM Run record filtering', () => {
  it('separates current, attention, completed, and cancelled records', () => {
    const current = runWith('run.current', 'Current workflow', 'running')
    const attention = runWith('run.attention', 'Attention workflow', 'blocked')
    const completed = runWith('run.completed', 'Completed workflow', 'completed')
    const cancelled = runWith('run.cancelled', 'Cancelled workflow', 'cancelled')
    const runs = [completed, current, cancelled, attention]

    expect(countMamRunRecords(runs)).toEqual({
      current: 1,
      attention: 1,
      completed: 1,
      cancelled: 1,
      all: 4
    })
    expect(filterMamRunRecords(runs, 'attention', '')).toEqual([attention])
    expect(filterMamRunRecords(runs, 'completed', '')).toEqual([completed])
    expect(preferredMamRunRecordView(runs)).toBe('attention')
  })

  it('promotes actionable Task state without treating old failed Attempts as current failures', () => {
    const attention = runWith('run.task-attention', 'Task attention', 'running')
    attention.tasks.push({
      id: 'task.attention',
      title: 'Fix verification',
      kind: 'static',
      status: 'changes_requested',
      dependencies: [],
      recommendedRoleProfileIds: [],
      allowedRoleProfileIds: [],
      attemptIds: [],
      reviewIds: [],
      executionWarningCount: 0
    })
    const current = runWith('run.recovered', 'Recovered workflow', 'running')
    current.attempts.push({ id: 'attempt.old', taskId: 'task.old', status: 'blocked' })

    expect(mamRunRecordView(attention)).toBe('attention')
    expect(mamRunRecordView(current)).toBe('current')
  })

  it('searches workflow names and stable identifiers', () => {
    const first = runWith('run.alpha', 'Guessing game', 'running')
    const second = runWith('run.beta', 'Release workflow', 'running')

    expect(filterMamRunRecords([first, second], 'all', 'guess')).toEqual([first])
    expect(filterMamRunRecords([first, second], 'all', 'run.beta')).toEqual([second])
  })
})

function runWith(
  id: string,
  definitionName: string,
  status: ReturnType<typeof mamUiRunFixture>['run']['status']
) {
  const run = mamUiRunFixture()
  run.run.id = id
  run.run.status = status
  run.definitionName = definitionName
  return run
}
