import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MamReviewsPage } from './MamReviewsPage'
import { mamUiFixtureHash, mamUiRunFixture } from './mam-renderer-snapshot-fixture'

describe('MamReviewsPage', () => {
  it('renders immutable findings and a human-decision aggregation', () => {
    const run = mamUiRunFixture()
    const subject = {
      taskId: 'task.build',
      attemptId: 'attempt.build',
      resultHash: mamUiFixtureHash,
      artifactHashes: [mamUiFixtureHash]
    }
    run.reviews.push({
      schemaVersion: '1.0.0',
      id: 'review.security',
      workflowRunId: run.run.id,
      reviewNodeId: 'review-gate',
      attemptId: 'attempt.build',
      subject,
      reviewerTaskId: 'task.review',
      reviewerAttemptId: 'attempt.review',
      reviewerRoleInstanceId: 'role-instance.reviewer',
      status: 'changes_requested',
      findings: [
        {
          schemaVersion: '1.0.0',
          id: 'finding.security',
          attemptId: 'attempt.build',
          severity: 'high',
          category: 'security',
          summary: 'Validate the untrusted path before opening it.',
          evidence: [],
          filePath: 'src/open-project.ts',
          line: 42
        }
      ],
      summary: 'One high-severity issue remains.',
      createdAt: '2026-07-28T18:00:00Z'
    })
    run.reviewAggregations.push({
      schemaVersion: '1.0.0',
      id: 'aggregation.security',
      workflowRunId: run.run.id,
      reviewNodeId: 'review-gate',
      attemptId: 'attempt.build',
      subject,
      classification: 'blocking_disagreement',
      sourceDecisionIds: ['review.security'],
      findings: run.reviews[0]!.findings,
      proposedStatus: 'blocked',
      requiresHumanDecision: true,
      createdAt: '2026-07-28T18:01:00Z'
    })

    const markup = renderToStaticMarkup(
      <MamReviewsPage
        runs={[run]}
        pending={false}
        onSubmitReview={async () => undefined}
        onResolveDisagreement={async () => undefined}
        onGetAttemptDiff={async ({ attemptId }) => ({
          attemptId,
          submittedCommit: 'abcdef1234567',
          diff: 'diff --git a/src/open-project.ts b/src/open-project.ts',
          truncated: false
        })}
      />
    )
    expect(markup).toContain('Human decision')
    expect(markup).toContain('One high-severity issue remains.')
    expect(markup).toContain('Validate the untrusted path before opening it.')
    expect(markup).toContain('src/open-project.ts:42')
    expect(markup).toContain('Request changes')
    expect(markup).toContain('System Review summaries')
    expect(markup).toContain('these are not additional reviewers')
  })

  it('shows the submitted result and Git evidence before the Review action', () => {
    const run = mamUiRunFixture()
    const subject = {
      taskId: 'task.build',
      attemptId: 'attempt.build',
      resultHash: mamUiFixtureHash,
      artifactHashes: [mamUiFixtureHash],
      submittedCommit: 'abcdef1234567'
    }
    run.tasks.push(
      {
        id: 'task.build',
        title: 'Build the game',
        kind: 'static',
        status: 'in_review',
        dependencies: [],
        recommendedRoleProfileIds: [],
        allowedRoleProfileIds: [],
        attemptIds: ['attempt.build'],
        selectedAttemptId: 'attempt.build',
        reviewIds: [],
        executionWarningCount: 0
      },
      {
        id: 'task.review',
        title: 'Review the game',
        kind: 'review',
        status: 'running',
        reviewSubject: subject,
        dependencies: [],
        recommendedRoleProfileIds: [],
        allowedRoleProfileIds: [],
        attemptIds: ['attempt.review'],
        reviewIds: [],
        executionWarningCount: 0
      }
    )
    run.attempts.push(
      {
        id: 'attempt.build',
        taskId: 'task.build',
        status: 'submitted',
        result: {
          schemaVersion: '1.0.0',
          status: 'submitted',
          summary: 'A complete browser game with keyboard controls.',
          verifications: [{ command: 'pnpm test', status: 'passed' }],
          risks: [],
          followUps: [],
          artifacts: [
            {
              contractId: 'artifact.web-files',
              type: 'file-set',
              contentRef: 'artifacts/web-files.json',
              sha256: mamUiFixtureHash
            }
          ],
          usage: { status: 'unknown' },
          system: {
            workflowRunId: run.run.id,
            nodeRunId: 'node.build',
            taskId: 'task.build',
            attemptId: 'attempt.build',
            roleInstanceId: 'role-instance.builder',
            executorInvocationId: 'invocation.build',
            effectiveConfigHash: mamUiFixtureHash,
            submittedCommit: subject.submittedCommit,
            createdAt: '2026-07-28T18:00:00Z'
          }
        }
      },
      {
        id: 'attempt.review',
        taskId: 'task.review',
        status: 'running',
        roleInstanceId: 'role-instance.reviewer'
      }
    )

    const markup = renderToStaticMarkup(
      <MamReviewsPage
        runs={[run]}
        pending={false}
        onSubmitReview={async () => undefined}
        onResolveDisagreement={async () => undefined}
        onGetAttemptDiff={async ({ attemptId }) => ({
          attemptId,
          submittedCommit: subject.submittedCommit,
          diff: 'diff --git a/index.html b/index.html',
          truncated: false
        })}
      />
    )

    expect(markup).toContain('Work to review')
    expect(markup).toContain('A complete browser game with keyboard controls.')
    expect(markup).toContain('file-set · artifacts/web-files.json')
    expect(markup).toContain('Git changes')
    expect(markup).toContain(subject.submittedCommit)
    expect(markup).toContain('Loading diff…')
    expect(markup.indexOf('Work to review')).toBeLessThan(markup.indexOf('Review and decide'))
  })

  it('links an approved decision to the Run integration stage it released', () => {
    const run = mamUiRunFixture()
    const subject = {
      taskId: 'task.build',
      attemptId: 'attempt.build',
      resultHash: mamUiFixtureHash,
      artifactHashes: [mamUiFixtureHash]
    }
    run.reviews.push({
      schemaVersion: '1.0.0',
      id: 'review.approved',
      workflowRunId: run.run.id,
      reviewNodeId: 'review-gate',
      attemptId: 'attempt.build',
      subject,
      reviewerTaskId: 'task.review',
      reviewerAttemptId: 'attempt.review',
      reviewerRoleInstanceId: 'role-instance.reviewer',
      status: 'approved',
      findings: [],
      summary: 'Ready to integrate.',
      createdAt: '2026-07-28T18:00:00Z'
    })
    run.mergeQueueEntries.push({
      schemaVersion: '1.0.0',
      id: 'merge.approved',
      workflowRunId: run.run.id,
      mergeNodeId: 'merge.develop',
      taskId: 'task.build',
      attemptId: 'attempt.build',
      targetBranch: 'develop',
      sourceBranch: 'tasks/build',
      submittedCommit: 'abcdef1',
      resultHash: mamUiFixtureHash,
      mergeReadyAt: '2026-07-28T18:01:00Z',
      readyRevisionHash: mamUiFixtureHash,
      reviewDecisionIds: ['review.approved'],
      validationEvidence: {},
      strategy: 'no_ff',
      conflictPolicy: 'coordinator_attempt',
      status: 'queued'
    })

    const markup = renderToStaticMarkup(
      <MamReviewsPage
        runs={[run]}
        pending={false}
        onSubmitReview={async () => undefined}
        onResolveDisagreement={async () => undefined}
        onOpenIntegration={() => undefined}
        onGetAttemptDiff={async ({ attemptId }) => ({
          attemptId,
          submittedCommit: 'abcdef1',
          diff: '',
          truncated: false
        })}
      />
    )

    expect(markup).toContain('released commit abcdef1 to the develop integration stage')
    expect(markup).toContain('View integration activity')
  })
})
