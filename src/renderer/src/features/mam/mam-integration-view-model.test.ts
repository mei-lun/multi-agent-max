import { describe, expect, it } from 'vitest'
import { mamUiRunFixture } from './mam-renderer-snapshot-fixture'
import {
  mamIntegrationEmptyState,
  mamIntegrationSection,
  mamIntegrationSectionCounts
} from './mam-integration-view-model'

describe('MAM integration view model', () => {
  it('groups operational states ahead of immutable history', () => {
    const run = mamUiRunFixture()
    const item = {
      run,
      entry: {
        schemaVersion: '1.0.0' as const,
        id: 'merge.failed',
        workflowRunId: run.run.id,
        mergeNodeId: 'merge',
        taskId: 'task.build',
        attemptId: 'attempt.build',
        targetBranch: 'develop',
        sourceBranch: 'tasks/build',
        submittedCommit: 'abcdef1',
        resultHash: 'a'.repeat(64),
        mergeReadyAt: '2026-07-28T18:00:00Z',
        readyRevisionHash: 'a'.repeat(64),
        reviewDecisionIds: ['review.build'],
        validationEvidence: {},
        strategy: 'no_ff' as const,
        conflictPolicy: 'coordinator_attempt' as const,
        status: 'failed' as const,
        completedAt: '2026-07-28T18:01:00Z',
        failureReason: 'validation failed'
      }
    }

    expect(mamIntegrationSection(item)).toBe('attention')
    expect(mamIntegrationSectionCounts([item])).toEqual({
      attention: 1,
      integrating: 0,
      queued: 0,
      history: 0
    })
  })

  it('does not claim a missing merge node when no frozen definition is available', () => {
    const state = mamIntegrationEmptyState([mamUiRunFixture()], [])

    expect(state.title).toBe('No current integration activity')
    expect(state.action).toBe('runs')
  })

  it('offers a new delivery Workflow instead of mutating completed Run history', () => {
    const run = mamUiRunFixture()
    const state = mamIntegrationEmptyState(
      [run],
      [
        {
          schemaVersion: '1.0.0',
          id: run.run.definitionId,
          name: run.definitionName,
          version: run.run.definitionVersion,
          nodes: [{ id: 'finish', type: 'finish', inputs: [] }],
          edges: [],
          maxTransitions: 10,
          maxRunCostUsd: 1,
          maxRunDurationSeconds: 60
        }
      ]
    )

    expect(state.action).toBe('workflows')
    expect(state.actionLabel).toBe('Create delivery Workflow')
    expect(state.detail).toContain('Completed Run history remains unchanged')
  })
})
