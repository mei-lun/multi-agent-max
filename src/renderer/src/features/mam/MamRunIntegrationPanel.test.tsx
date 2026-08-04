import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { WorkflowDefinition } from '../../../../shared/mam/domain/workflow'
import { MamRunIntegrationPanel } from './MamRunIntegrationPanel'
import { mamUiRunFixture } from './mam-renderer-snapshot-fixture'

const hash = 'a'.repeat(64)

describe('MamRunIntegrationPanel', () => {
  it('shows configured merge stages before and after a queue entry exists', () => {
    const run = mamUiRunFixture()
    run.mergeQueueEntries.push({
      schemaVersion: '1.0.0',
      id: 'merge-entry.develop',
      workflowRunId: run.run.id,
      mergeNodeId: 'merge.develop',
      taskId: 'task.build',
      attemptId: 'attempt.build',
      targetBranch: 'develop',
      sourceBranch: 'tasks/build',
      submittedCommit: 'abcdef1',
      resultHash: hash,
      mergeReadyAt: '2026-07-28T18:00:00Z',
      readyRevisionHash: hash,
      reviewDecisionIds: ['review.build'],
      validationEvidence: {},
      strategy: 'no_ff',
      conflictPolicy: 'coordinator_attempt',
      status: 'queued'
    })

    const markup = renderToStaticMarkup(
      <MamRunIntegrationPanel
        run={run}
        definition={workflowDefinition()}
        onOpenIntegration={() => {}}
      />
    )

    expect(markup).toContain('Integration stages')
    expect(markup).toContain('Integrate into develop')
    expect(markup).toContain('Reviewed commit abcdef1 is ready.')
    expect(markup).toContain('Integrate into main')
    expect(markup).toContain('Waiting for upstream Workflow prerequisites.')
    expect(markup).toContain('View integration activity')
  })
})

function workflowDefinition(): WorkflowDefinition {
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.ui',
    name: 'UI workflow',
    version: 1,
    nodes: [
      {
        id: 'merge.develop',
        type: 'git_merge',
        recommendedRoleProfileIds: [],
        allowedRoleProfileIds: [],
        targetBranch: 'develop',
        orderBy: 'merge_ready_at',
        strategy: 'no_ff',
        conflictPolicy: 'coordinator_attempt',
        validations: []
      },
      {
        id: 'merge.main',
        type: 'git_merge',
        recommendedRoleProfileIds: [],
        allowedRoleProfileIds: [],
        targetBranch: 'main',
        orderBy: 'merge_ready_at',
        strategy: 'no_ff',
        conflictPolicy: 'coordinator_attempt',
        validations: []
      },
      { id: 'finish', type: 'finish', inputs: [] }
    ],
    edges: [
      { from: 'merge.develop', to: 'merge.main' },
      { from: 'merge.main', to: 'finish' }
    ],
    maxTransitions: 10,
    maxRunCostUsd: 1,
    maxRunDurationSeconds: 60
  }
}
