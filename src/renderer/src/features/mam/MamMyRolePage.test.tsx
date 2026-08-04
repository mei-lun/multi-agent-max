import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MamMyRolePage } from './MamMyRolePage'
import {
  mamUiFixtureHash,
  mamUiRoleFixture,
  mamUiRunFixture
} from './mam-renderer-snapshot-fixture'

describe('MamMyRolePage', () => {
  it('shows only persisted Task assignments for the selected Role', () => {
    const run = mamUiRunFixture()
    run.run.roleCatalog.push({
      roleProfileId: 'role.builder',
      roleProfileVersion: 1,
      contentHash: mamUiFixtureHash
    })
    const reviewer = {
      ...mamUiRoleFixture(),
      id: 'role.reviewer',
      displayName: 'Reviewer'
    }
    run.roleProfiles.push(mamUiRoleFixture(), reviewer)
    run.run.roleCatalog.push({
      roleProfileId: reviewer.id,
      roleProfileVersion: reviewer.version,
      contentHash: mamUiFixtureHash
    })
    run.tasks.push({
      id: 'task.assigned',
      title: 'Assigned implementation',
      kind: 'dynamic',
      status: 'running',
      roleProfileId: 'role.builder',
      roleProfileVersion: 1,
      assignedByUserId: 'user.owner',
      dependencies: [],
      recommendedRoleProfileIds: ['role.builder'],
      allowedRoleProfileIds: ['role.builder'],
      attemptIds: ['attempt.assigned'],
      reviewIds: [],
      executionWarningCount: 2
    })
    run.attempts.push({
      id: 'attempt.assigned',
      taskId: 'task.assigned',
      status: 'running'
    })
    run.tasks.push({
      id: 'task.other',
      title: 'Other role task',
      kind: 'static',
      status: 'ready',
      roleProfileId: 'role.other',
      dependencies: [],
      recommendedRoleProfileIds: ['role.other'],
      allowedRoleProfileIds: ['role.other'],
      attemptIds: [],
      reviewIds: [],
      executionWarningCount: 0
    })
    run.tasks.push({
      id: 'task.correctable',
      title: 'Correctable assignment',
      kind: 'static',
      status: 'ready',
      roleProfileId: 'role.builder',
      roleProfileVersion: 1,
      dependencies: [],
      recommendedRoleProfileIds: ['role.reviewer'],
      allowedRoleProfileIds: ['role.builder', 'role.reviewer'],
      attemptIds: [],
      reviewIds: [],
      executionWarningCount: 0
    })
    run.tasks.push({
      id: 'task.available',
      title: 'Available implementation',
      kind: 'static',
      status: 'waiting_role_assignment',
      dependencies: [],
      recommendedRoleProfileIds: ['role.builder'],
      allowedRoleProfileIds: ['role.builder'],
      attemptIds: [],
      reviewIds: [],
      executionWarningCount: 0
    })
    const markup = renderToStaticMarkup(
      <MamMyRolePage
        pending={false}
        onAssignTask={() => undefined}
        onReassignTask={async () => undefined}
        onStartAttempt={async () => undefined}
        onSaveLocalSettings={async () => undefined}
        snapshot={{
          schemaVersion: '1.0.0',
          generatedAt: '2026-07-28T18:00:00Z',
          roles: [mamUiRoleFixture()],
          executors: [],
          providers: [],
          models: [],
          skills: [],
          mcpServers: [],
          knowledgeBases: [],
          workflows: [],
          localSettings: {
            schemaVersion: '1.0.0',
            bindingIdentity: 'machine.test',
            gitExecutable: 'git',
            executorBindings: [],
            secretBindings: [],
            mcpConnections: [],
            skillBindings: [],
            knowledgeBindings: []
          },
          runs: [run],
          issues: []
        }}
      />
    )
    expect(markup).toContain('Assigned implementation')
    expect(markup).toContain('Assigned by user.owner')
    expect(markup).toContain('2 concurrent execution warnings')
    expect(markup).toContain('Start Attempt')
    expect(markup).toContain('Available implementation')
    expect(markup).toContain('Assign to Builder')
    expect(markup).toContain('Recover every active Attempt before changing this Role.')
    expect(markup).toContain('Correctable assignment')
    expect(markup).toContain('Change Role')
    expect(markup).not.toContain('Other role task')
  })
})
