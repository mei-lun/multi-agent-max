import { describe, expect, it } from 'vitest'
import type { ReviewTaskDefinition } from '../../../shared/mam/domain/review'
import { buildReviewSubmissionCommand } from './mam-review-submission'

const hash = 'a'.repeat(64)

describe('MAM Review submission authority builder', () => {
  it('binds user-entered findings to Main-owned immutable reviewer and subject fields', () => {
    const command = buildReviewSubmissionCommand({
      request: {
        workflowRunId: 'run.review',
        reviewerTaskId: 'task.review',
        reviewerAttemptId: 'attempt.reviewer',
        status: 'changes_requested',
        summary: 'One issue remains.',
        findings: [
          {
            severity: 'high',
            category: 'security',
            summary: 'Validate the path.',
            filePath: 'src/open.ts',
            line: 42
          }
        ]
      },
      definition: reviewTaskDefinition(),
      binding: {
        roleInstanceId: 'role-instance.reviewer',
        executorInvocationId: 'invocation.reviewer'
      },
      commandId: 'command.review-submit',
      createdAt: '2026-07-28T20:00:00Z'
    })
    expect(command.actor).toEqual({
      kind: 'executor',
      roleInstanceId: 'role-instance.reviewer',
      attemptId: 'attempt.reviewer',
      executorInvocationId: 'invocation.reviewer'
    })
    expect(command.review).toMatchObject({
      id: 'review.command.review-submit',
      attemptId: 'attempt.subject',
      subject: { attemptId: 'attempt.subject', resultHash: hash },
      reviewerAttemptId: 'attempt.reviewer',
      findings: [
        {
          id: 'review.command.review-submit.finding.1',
          attemptId: 'attempt.subject',
          severity: 'high'
        }
      ]
    })
  })
})

function reviewTaskDefinition(): ReviewTaskDefinition {
  return {
    schemaVersion: '1.0.0',
    id: 'task.review',
    workflowRunId: 'run.review',
    nodeRunId: 'node-run.review',
    reviewNodeId: 'review',
    subject: {
      taskId: 'task.subject',
      attemptId: 'attempt.subject',
      resultHash: hash,
      artifactHashes: []
    },
    initialStatus: 'waiting_role_assignment',
    title: 'Review subject',
    specification: 'Review the immutable subject.',
    inputArtifacts: [],
    outputContracts: [
      {
        schemaVersion: '1.0.0',
        artifactType: 'artifact.review',
        format: 'json-schema',
        required: true,
        maxBytes: 100_000,
        jsonSchema: { type: 'object' }
      }
    ],
    recommendedRoleProfileIds: ['role.reviewer'],
    allowedRoleProfileIds: ['role.reviewer']
  }
}
