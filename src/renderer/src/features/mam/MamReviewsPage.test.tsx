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
      />
    )
    expect(markup).toContain('Human decision')
    expect(markup).toContain('One high-severity issue remains.')
    expect(markup).toContain('Validate the untrusted path before opening it.')
    expect(markup).toContain('src/open-project.ts:42')
    expect(markup).toContain('Request changes')
  })
})
