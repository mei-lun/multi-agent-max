import { describe, expect, it } from 'vitest'
import type { MamUiRunSnapshot } from '../../../../shared/mam/ui-projection'
import {
  mamUiFixtureHash,
  mamUiRoleFixture,
  mamUiRunFixture
} from './mam-renderer-snapshot-fixture'
import { taskRoleCandidates } from './mam-task-role-candidates'

describe('Task Role candidates', () => {
  it('uses frozen Run versions, applies the Task allowlist, and sorts recommendations first', () => {
    const run = runWithRoles()
    expect(
      taskRoleCandidates(run, task(['role.reviewer', 'role.coordinator'], ['role.coordinator']))
    ).toEqual([
      {
        roleProfileId: 'role.coordinator',
        roleProfileVersion: 3,
        displayName: 'Coordinator',
        recommended: true
      },
      {
        roleProfileId: 'role.reviewer',
        roleProfileVersion: 2,
        displayName: 'Reviewer',
        recommended: false
      }
    ])
  })

  it('treats an empty Task allowlist as the full frozen Run catalog', () => {
    expect(
      taskRoleCandidates(runWithRoles(), task([], [])).map((role) => role.roleProfileId)
    ).toEqual(['role.coordinator', 'role.reviewer'])
  })
})

function runWithRoles(): MamUiRunSnapshot {
  const run = mamUiRunFixture()
  const roles = [
    { ...mamUiRoleFixture(), id: 'role.builder', version: 1, displayName: 'Builder' },
    { ...mamUiRoleFixture(), id: 'role.reviewer', version: 2, displayName: 'Reviewer' },
    { ...mamUiRoleFixture(), id: 'role.coordinator', version: 3, displayName: 'Coordinator' }
  ]
  run.roleProfiles = roles
  run.run.roleCatalog = roles.map((role) => ({
    roleProfileId: role.id,
    roleProfileVersion: role.version,
    contentHash: mamUiFixtureHash
  }))
  return run
}

function task(
  allowedRoleProfileIds: string[],
  recommendedRoleProfileIds: string[]
): MamUiRunSnapshot['tasks'][number] {
  return {
    id: 'task.change-role',
    title: 'Change Role fixture',
    kind: 'static',
    status: 'ready',
    roleProfileId: 'role.builder',
    roleProfileVersion: 1,
    dependencies: [],
    recommendedRoleProfileIds,
    allowedRoleProfileIds,
    attemptIds: [],
    reviewIds: [],
    executionWarningCount: 0
  }
}
