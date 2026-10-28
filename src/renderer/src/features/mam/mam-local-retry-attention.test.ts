import { describe, expect, it } from 'vitest'
import { mamUiSnapshotFixture } from './mam-renderer-snapshot-fixture'
import { localRetryAttention } from './mam-local-retry-attention'

describe('local connection retry attention', () => {
  it('lists an exhausted local Draft and its dependent Task count', () => {
    const snapshot = mamUiSnapshotFixture()
    snapshot.localRetryItems.push({
      workflowRunId: 'run.ui',
      taskId: 'task.waiting',
      draftId: 'draft.waiting',
      errorCode: 'executor_connection_failed',
      occurredAt: '2026-07-28T18:00:00Z',
      automaticRetriesUsed: 1,
      automaticRetryLimit: 2,
      canRetry: true
    })
    snapshot.runs[0]!.tasks.push(
      {
        id: 'task.waiting',
        title: 'Waiting Task',
        kind: 'static',
        status: 'running',
        dependencies: [],
        recommendedRoleProfileIds: [],
        allowedRoleProfileIds: [],
        attemptIds: [],
        reviewIds: [],
        executionWarningCount: 0
      },
      {
        id: 'task.downstream',
        title: 'Downstream Task',
        kind: 'static',
        status: 'waiting_dependencies',
        dependencies: ['task.waiting'],
        recommendedRoleProfileIds: [],
        allowedRoleProfileIds: [],
        attemptIds: [],
        reviewIds: [],
        executionWarningCount: 0
      },
      {
        id: 'task.independent',
        title: 'Independent Task',
        kind: 'static',
        status: 'ready',
        dependencies: [],
        recommendedRoleProfileIds: [],
        allowedRoleProfileIds: [],
        attemptIds: [],
        reviewIds: [],
        executionWarningCount: 0
      }
    )
    expect(localRetryAttention(snapshot)).toMatchObject([
      { taskTitle: 'Waiting Task', blockedTaskCount: 2 }
    ])
  })
})
