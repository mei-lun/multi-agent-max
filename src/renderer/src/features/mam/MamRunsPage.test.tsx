import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MamRunsPage } from './MamRunsPage'
import {
  mamUiFixtureHash,
  mamUiRoleFixture,
  mamUiRunFixture,
  mamUiSnapshotFixture
} from './mam-renderer-snapshot-fixture'

describe('MamRunsPage', () => {
  it('renders task metadata and Attempt result lineage from the Application snapshot', () => {
    const run = mamUiRunFixture()
    const role = mamUiRoleFixture()
    run.roleProfiles = [role]
    run.run.roleCatalog = [
      {
        roleProfileId: role.id,
        roleProfileVersion: role.version,
        contentHash: mamUiFixtureHash
      }
    ]
    run.approvalGates = [
      {
        id: 'approval.release',
        prompt: 'Release this revision?',
        options: ['Continue', 'Stop'],
        status: 'pending'
      }
    ]
    run.tasks.push({
      id: 'task.build',
      title: 'Build feature',
      kind: 'static',
      status: 'submitted',
      roleProfileId: 'role.builder',
      dependencies: ['task.plan'],
      recommendedRoleProfileIds: ['role.builder'],
      allowedRoleProfileIds: ['role.builder'],
      attemptIds: ['attempt.build.1', 'attempt.build.2'],
      selectedAttemptId: 'attempt.build.2',
      reviewIds: [],
      executionWarningCount: 1
    })
    run.attempts.push(
      {
        id: 'attempt.build.1',
        taskId: 'task.build',
        status: 'blocked'
      },
      {
        id: 'attempt.build.2',
        taskId: 'task.build',
        previousAttemptId: 'attempt.build.1',
        status: 'submitted',
        result: {
          schemaVersion: '1.0.0',
          status: 'submitted',
          summary: 'Feature implementation is ready for review.',
          verifications: [{ command: 'pnpm test', status: 'passed' }],
          risks: [],
          followUps: [],
          artifacts: [],
          usage: { status: 'known', inputTokens: 12, outputTokens: 34 },
          system: {
            workflowRunId: 'run.ui',
            nodeRunId: 'node-run.build',
            taskId: 'task.build',
            attemptId: 'attempt.build.2',
            roleInstanceId: 'role-instance.build',
            executorInvocationId: 'invocation.build',
            effectiveConfigHash: mamUiFixtureHash,
            submittedCommit: 'abcdef1',
            createdAt: '2026-07-28T18:00:00Z'
          }
        }
      }
    )
    run.tasks.push({
      id: 'task.reconcile',
      title: 'Reconcile interrupted execution',
      kind: 'static',
      status: 'needs_attention',
      roleProfileId: 'role.builder',
      roleProfileVersion: 1,
      dependencies: [],
      recommendedRoleProfileIds: ['role.builder'],
      allowedRoleProfileIds: ['role.builder'],
      attemptIds: ['attempt.reconcile.1'],
      reviewIds: [],
      executionWarningCount: 0
    })
    run.attempts.push({
      id: 'attempt.reconcile.1',
      taskId: 'task.reconcile',
      status: 'needs_reconciliation'
    })
    run.tasks.push({
      id: 'task.review',
      title: 'Review implementation',
      kind: 'review',
      status: 'waiting_role_assignment',
      dependencies: ['task.build'],
      recommendedRoleProfileIds: ['role.builder'],
      allowedRoleProfileIds: ['role.builder'],
      attemptIds: [],
      reviewIds: [],
      executionWarningCount: 0
    })

    const markup = renderToStaticMarkup(
      <MamRunsPage
        runs={[run]}
        roles={[role]}
        localSettings={{
          schemaVersion: '1.0.0',
          bindingIdentity: 'machine.test',
          gitExecutable: 'git',
          participatingRoleProfileIds: ['role.builder'],
          executorBindings: [],
          secretBindings: [],
          mcpConnections: [],
          skillBindings: [],
          knowledgeBindings: []
        }}
        collaborationErrors={new Map()}
        pending={false}
        onSaveLocalSettings={async () => undefined}
        onAssignTask={async () => undefined}
        onStartAttempt={async () => undefined}
        onCancelWorkflowRun={async () => undefined}
        onRestartWorkflowRun={async () => mamUiSnapshotFixture()}
        onRecoverAttempt={async () => undefined}
        onSelectAttempt={async () => undefined}
        onResolveApprovalGate={async () => undefined}
        onGetAttemptDiff={async ({ attemptId }) => ({
          attemptId,
          submittedCommit: 'abcdef1',
          diff: '',
          truncated: false
        })}
      />
    )
    expect(markup).toContain('Build feature')
    expect(markup).toContain('Builder')
    expect(markup).toContain('Previous Attempt:')
    expect(markup).toContain('Feature implementation is ready for review.')
    expect(markup).toContain('pnpm test')
    expect(markup).toContain('abcdef1')
    expect(markup).toContain('Release this revision?')
    expect(markup).toContain('Continue')
    expect(markup).toContain('Confirm before retry')
    expect(markup).toContain('Clean or continue')
    expect(markup).toContain('Workflow Role: Builder')
    expect(markup).toContain('Run Task')
    expect(markup).not.toContain('Assign Role')
    expect(markup).not.toContain('Change Role')
    expect(markup).toContain('Technical details')
    expect(markup).toContain('Expected outputs')
  })

  it('shows a running local Role without offering interruption recovery or another start', () => {
    const run = mamUiRunFixture()
    const role = mamUiRoleFixture()
    run.roleProfiles = [role]
    run.tasks.push({
      id: 'task.design',
      title: 'Create design spec',
      kind: 'static',
      status: 'running',
      roleProfileId: role.id,
      roleProfileVersion: role.version,
      dependencies: [],
      recommendedRoleProfileIds: [role.id],
      allowedRoleProfileIds: [role.id],
      attemptIds: ['attempt.design'],
      reviewIds: [],
      executionWarningCount: 0
    })
    run.attempts.push({ id: 'attempt.design', taskId: 'task.design', status: 'running' })

    const markup = renderToStaticMarkup(
      <MamRunsPage
        runs={[run]}
        roles={[role]}
        localSettings={{
          schemaVersion: '1.0.0',
          bindingIdentity: 'machine.test',
          gitExecutable: 'git',
          participatingRoleProfileIds: [role.id],
          automaticWorkflowRunIds: [run.run.id],
          executorBindings: [],
          secretBindings: [],
          mcpConnections: [],
          skillBindings: [],
          knowledgeBindings: []
        }}
        collaborationErrors={new Map()}
        pending={false}
        onSaveLocalSettings={async () => undefined}
        onAssignTask={async () => undefined}
        onStartAttempt={async () => undefined}
        onCancelWorkflowRun={async () => undefined}
        onRestartWorkflowRun={async () => mamUiSnapshotFixture()}
        onRecoverAttempt={async () => undefined}
        onSelectAttempt={async () => undefined}
        onResolveApprovalGate={async () => undefined}
        onGetAttemptDiff={async ({ attemptId }) => ({
          attemptId,
          submittedCommit: 'abcdef1',
          diff: '',
          truncated: false
        })}
      />
    )

    expect(markup).toContain('Local Role is working on Create design spec')
    expect(markup).toContain('This is an active Attempt, not an interrupted one')
    expect(markup).not.toContain('Recover interrupted Attempt')
    expect(markup).not.toContain('Start Attempt')
  })
})
