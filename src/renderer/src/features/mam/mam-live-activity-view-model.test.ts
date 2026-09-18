import { describe, expect, it } from 'vitest'
import { mamUiRoleFixture, mamUiRunFixture } from './mam-renderer-snapshot-fixture'
import { mamLiveNodes } from './mam-live-activity-view-model'

describe('MAM live activity view model', () => {
  it('projects an active local Draft before a Formal Attempt exists', () => {
    const run = mamUiRunFixture()
    const role = mamUiRoleFixture()
    run.roleProfiles = [role]
    run.nodeRuns.push({
      schemaVersion: '1.0.0',
      id: 'node-run.live',
      nodeId: 'node.live',
      status: 'ready',
      attemptIds: []
    })
    run.tasks.push({
      id: 'task.live',
      title: 'Build the feature',
      kind: 'static',
      status: 'ready',
      roleProfileId: role.id,
      roleProfileVersion: role.version,
      activeClaim: {
        schemaVersion: '1.0.0',
        claimId: 'claim.live',
        taskId: 'task.live',
        roleProfileId: role.id,
        roleProfileVersion: role.version,
        claimantInstanceId: 'claimant.machine-test',
        generation: 1,
        claimedAt: '2026-07-28T17:30:00Z'
      },
      dependencies: [],
      recommendedRoleProfileIds: [role.id],
      allowedRoleProfileIds: [role.id],
      attemptIds: [],
      reviewIds: [],
      executionWarningCount: 0
    })
    run.activities.push({
      id: 'activity.live',
      at: '2026-07-28T17:31:00Z',
      nodeId: 'node.live',
      taskId: 'task.live',
      attemptId: 'attempt.local-draft',
      roleInstanceId: 'role-instance.live',
      executorInvocationId: 'executor-invocation.live',
      category: 'message',
      title: 'Agent message',
      detail: 'Working now.'
    })

    expect(mamLiveNodes(run, undefined)[0]).toMatchObject({
      id: 'node.live',
      status: 'running',
      task: { id: 'task.live' },
      roleName: role.displayName,
      activities: [{ detail: 'Working now.' }]
    })
  })
})
