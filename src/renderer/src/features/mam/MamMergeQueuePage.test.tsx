import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { MamUiRunSnapshot } from '../../../../shared/mam/ui-projection'
import { MamMergeQueuePage } from './MamMergeQueuePage'

const hash = 'a'.repeat(64)

describe('MamMergeQueuePage', () => {
  it('renders conflict Task and resolution Attempt lineage from the Application snapshot', () => {
    const markup = renderToStaticMarkup(
      <MamMergeQueuePage
        runs={[runSnapshot()]}
        pending={false}
        onExecuteNextMerge={async () => {}}
      />
    )
    expect(markup).toContain('Coordinator conflict lineage')
    expect(markup).toContain('merge-conflict-task.a')
    expect(markup).toContain('Resolved by Attempt attempt.resolution.a')
    expect(markup).toContain('Merged')
    expect(markup).toContain('Recent integration history')
    expect(markup).toContain('Open Run')
  })

  it('explains automatic integration without competing with it using a manual action', () => {
    const run = runSnapshot()
    run.mergeQueueEntries[0]!.status = 'queued'
    delete run.mergeQueueEntries[0]!.completedAt
    delete run.mergeQueueEntries[0]!.mergeCommit
    const markup = renderToStaticMarkup(
      <MamMergeQueuePage
        runs={[run]}
        localSettings={{
          schemaVersion: '1.0.0',
          bindingIdentity: 'machine.test',
          gitExecutable: 'git',
          automaticWorkflowRunIds: [run.run.id],
          executorBindings: [],
          secretBindings: [],
          mcpConnections: [],
          skillBindings: [],
          knowledgeBindings: []
        }}
        pending={false}
        onExecuteNextMerge={async () => {}}
      />
    )

    expect(markup).toContain('Waiting for integration')
    expect(markup).toContain('Local collaboration will integrate this revision automatically.')
    expect(markup).not.toContain('Execute next merge')
  })

  it('provides a Workflow action when there is no integration activity', () => {
    const markup = renderToStaticMarkup(
      <MamMergeQueuePage runs={[]} pending={false} onExecuteNextMerge={async () => {}} />
    )

    expect(markup).toContain('No integration activity yet')
    expect(markup).toContain('Create Workflow')
  })
})

function runSnapshot(): MamUiRunSnapshot {
  return {
    run: {
      schemaVersion: '1.0.0',
      id: 'run.ui',
      definitionId: 'workflow.ui',
      definitionVersion: 1,
      planHash: hash,
      roleCatalog: [],
      stateBackend: 'git',
      status: 'completed',
      nodeRuns: [],
      createdAt: '2026-07-28T17:00:00Z',
      updatedAt: '2026-07-28T18:10:00Z'
    },
    definitionName: 'UI workflow',
    roleProfiles: [],
    revision: hash,
    stateHash: hash,
    nodeRuns: [],
    readyTaskIds: [],
    tasks: [],
    attempts: [],
    reviews: [],
    reviewAggregations: [],
    reviewDisagreementResolutions: [],
    mergeQueueEntries: [
      {
        schemaVersion: '1.0.0',
        id: 'merge-entry.a',
        workflowRunId: 'run.ui',
        mergeNodeId: 'merge',
        taskId: 'task.a',
        attemptId: 'attempt.a',
        targetBranch: 'develop',
        sourceBranch: 'tasks/a',
        submittedCommit: 'abcdef1',
        resultHash: hash,
        mergeReadyAt: '2026-07-28T18:00:00Z',
        readyRevisionHash: hash,
        reviewDecisionIds: ['review.a'],
        validationEvidence: { 'pnpm test': hash },
        strategy: 'no_ff',
        conflictPolicy: 'coordinator_attempt',
        status: 'merged',
        claimedAt: '2026-07-28T18:01:00Z',
        detectedAt: '2026-07-28T18:02:00Z',
        completedAt: '2026-07-28T18:10:00Z',
        mergeCommit: 'bcdefa2',
        conflictTaskId: 'merge-conflict-task.a',
        resolutionAttemptId: 'attempt.resolution.a'
      }
    ],
    mergeConflictTasks: [
      {
        schemaVersion: '1.0.0',
        id: 'merge-conflict-task.a',
        workflowRunId: 'run.ui',
        mergeNodeId: 'merge',
        queueEntryId: 'merge-entry.a',
        parentTaskId: 'task.a',
        parentAttemptId: 'attempt.a',
        targetBranch: 'develop',
        sourceBranch: 'tasks/a',
        targetCommit: 'cdefab3',
        submittedCommit: 'abcdef1',
        mergeBase: 'defabc4',
        conflictingPaths: ['src/a.ts'],
        validationCommands: ['pnpm test'],
        recommendedRoleProfileIds: ['role.coordinator'],
        allowedRoleProfileIds: ['role.coordinator'],
        initialStatus: 'waiting_role_assignment',
        createdAt: '2026-07-28T18:02:00Z'
      }
    ],
    mergeConflictResolutions: [
      {
        schemaVersion: '1.0.0',
        id: 'merge-conflict-resolution.a',
        workflowRunId: 'run.ui',
        queueEntryId: 'merge-entry.a',
        conflictTaskId: 'merge-conflict-task.a',
        resolutionAttemptId: 'attempt.resolution.a',
        mergeCommit: 'bcdefa2',
        validationEvidence: { 'pnpm test': hash },
        completedAt: '2026-07-28T18:10:00Z'
      }
    ]
  }
}
