import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MamRunsPage } from './MamRunsPage'
import {
  mamUiFixtureHash,
  mamUiRoleFixture,
  mamUiRunFixture
} from './mam-renderer-snapshot-fixture'

describe('MamRunsPage', () => {
  it('renders task metadata and Attempt result lineage from the Application snapshot', () => {
    const run = mamUiRunFixture()
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

    const markup = renderToStaticMarkup(
      <MamRunsPage
        runs={[run]}
        roles={[mamUiRoleFixture()]}
        pending={false}
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
    expect(markup).toContain('Continues')
    expect(markup).toContain('Feature implementation is ready for review.')
    expect(markup).toContain('pnpm test')
    expect(markup).toContain('abcdef1')
    expect(markup).toContain('Release this revision?')
    expect(markup).toContain('Continue')
  })
})
