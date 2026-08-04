import { describe, expect, it } from 'vitest'
import { mamUiRunFixture, mamUiSnapshotFixture } from './mam-renderer-snapshot-fixture'
import { activateMamLocalCollaboration } from './mam-local-collaboration-settings'

describe('local collaboration settings', () => {
  it('moves restart authorization to the replacement Run and activates its Roles', () => {
    const snapshot = mamUiSnapshotFixture()
    const run = mamUiRunFixture()
    run.run.id = 'run.replacement'
    run.run.roleCatalog = [
      { roleProfileId: 'role.design', roleProfileVersion: 1, contentHash: 'a'.repeat(64) },
      { roleProfileId: 'role.review', roleProfileVersion: 1, contentHash: 'b'.repeat(64) }
    ]

    expect(
      activateMamLocalCollaboration({
        settings: {
          ...snapshot.localSettings,
          participatingRoleProfileIds: ['role.existing'],
          automaticWorkflowRunIds: ['run.old']
        },
        run,
        replaceRunId: 'run.old'
      })
    ).toMatchObject({
      participatingRoleProfileIds: ['role.existing', 'role.design', 'role.review'],
      automaticWorkflowRunIds: ['run.replacement']
    })
  })
})
