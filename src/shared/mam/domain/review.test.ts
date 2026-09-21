import { describe, expect, it } from 'vitest'
import { ReviewDecisionSchema } from './review'

describe('ReviewDecisionSchema', () => {
  it('allows approved decisions to retain high-severity suggestions', () => {
    expect(() => ReviewDecisionSchema.parse(decision('high'))).not.toThrow()
  })

  it('rejects approved decisions with fatal blocker findings', () => {
    expect(() => ReviewDecisionSchema.parse(decision('blocker'))).toThrow(
      'approval has blocking findings'
    )
  })
})

function decision(severity: 'blocker' | 'high') {
  return {
    schemaVersion: '1.0.0',
    id: 'review.test',
    workflowRunId: 'run.test',
    reviewNodeId: 'review-node.test',
    attemptId: 'attempt.subject',
    subject: {
      taskId: 'task.subject',
      attemptId: 'attempt.subject',
      resultHash: 'a'.repeat(64),
      artifactHashes: []
    },
    reviewerTaskId: 'review-task.test',
    reviewerAttemptId: 'attempt.reviewer',
    reviewerRoleInstanceId: 'role-instance.reviewer',
    status: 'approved',
    findings: [
      {
        schemaVersion: '1.0.0',
        id: 'finding.test',
        attemptId: 'attempt.subject',
        severity,
        category: 'correctness',
        summary: 'Improve this in a future version.',
        evidence: []
      }
    ],
    summary: 'Approved with follow-up suggestions.',
    createdAt: '2026-09-20T12:00:00Z'
  }
}
