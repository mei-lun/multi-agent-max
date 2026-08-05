import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MamLiveActivityPage } from './MamLiveActivityPage'
import { mamUiSnapshotFixture } from './mam-renderer-snapshot-fixture'

describe('MamLiveActivityPage', () => {
  it('arranges every projected node with live Role and command activity', () => {
    const snapshot = mamUiSnapshotFixture()
    const run = snapshot.runs[0]!
    run.run.nodeRuns = [nodeRun()]
    run.nodeRuns = [nodeRun()]
    run.tasks = [
      {
        id: 'task.build',
        title: 'Build number game',
        kind: 'static',
        status: 'running',
        roleProfileId: 'role.builder',
        roleProfileVersion: 1,
        dependencies: [],
        recommendedRoleProfileIds: ['role.builder'],
        allowedRoleProfileIds: ['role.builder'],
        attemptIds: ['attempt.build'],
        reviewIds: [],
        executionWarningCount: 0
      }
    ]
    run.roleProfiles = snapshot.roles
    run.attempts = [
      {
        id: 'attempt.build',
        taskId: 'task.build',
        status: 'running',
        roleInstanceId: 'role-instance.build'
      }
    ]
    run.activities = [
      {
        id: 'activity.1',
        at: '2026-08-05T02:30:00Z',
        nodeId: 'node.build',
        roleInstanceId: 'role-instance.build',
        executorInvocationId: 'executor-invocation.build',
        taskId: 'task.build',
        attemptId: 'attempt.build',
        category: 'command',
        title: 'Command',
        detail: 'pnpm test'
      }
    ]

    const markup = renderToStaticMarkup(
      <MamLiveActivityPage snapshot={snapshot} onExportExecutionActivity={async () => undefined} />
    )

    expect(markup).toContain('Live activity')
    expect(markup).toContain('Build number game')
    expect(markup).toContain('Builder')
    expect(markup).toContain('pnpm test')
    expect(markup).toContain('1</strong> nodes')
    expect(markup).toContain('View full activity')
    expect(markup).toContain('Export Run activity')
    expect(markup).toContain('h-[26rem]')
    expect(markup).toContain('overflow-y-auto')
  })
})

function nodeRun() {
  return {
    schemaVersion: '1.0.0' as const,
    id: 'node-run.build',
    nodeId: 'node.build',
    attemptIds: ['attempt.build'],
    latestAttemptId: 'attempt.build',
    status: 'running' as const,
    startedAt: '2026-08-05T02:29:00Z'
  }
}
