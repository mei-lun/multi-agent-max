import { describe, expect, it } from 'vitest'
import { mamUiRunFixture, mamUiSnapshotFixture } from './mam-renderer-snapshot-fixture'
import { roleRemovalImpact } from './MamDeleteRoleDialog'

describe('MAM Role removal impact', () => {
  it('reports frozen Run history and active Workflow references independently', () => {
    const snapshot = mamUiSnapshotFixture()
    const run = mamUiRunFixture()
    run.run.roleCatalog = [
      { roleProfileId: 'role.builder', roleProfileVersion: 1, contentHash: 'a'.repeat(64) }
    ]
    snapshot.runs = [run]
    snapshot.workflows = [
      {
        schemaVersion: '1.0.0',
        id: 'workflow.builder',
        name: 'Builder workflow',
        version: 1,
        nodes: [
          {
            id: 'build',
            type: 'role_task',
            instruction: 'Build.',
            workspaceMode: 'write',
            inputs: [],
            outputs: [],
            recommendedRoleProfileIds: ['role.builder'],
            allowedRoleProfileIds: ['role.builder']
          },
          { id: 'finish', type: 'finish', inputs: [] }
        ],
        edges: [{ from: 'build', to: 'finish' }],
        maxTransitions: 10,
        maxRunCostUsd: 1,
        maxRunDurationSeconds: 60
      }
    ]

    expect(roleRemovalImpact(snapshot, 'role.builder')).toEqual({
      historicalRuns: 1,
      workflowReferences: 1
    })
  })
})
