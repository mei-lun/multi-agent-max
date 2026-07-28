import { describe, expect, it } from 'vitest'
import type { ArtifactVersion } from '../../../shared/mam/domain/artifact'
import type { ReviewDecision } from '../../../shared/mam/domain/review'
import { ReviewExecutionCoordinator } from './review-execution-coordinator'

const targetSubject = {
  taskId: 'task.implementation',
  attemptId: 'attempt.implementation.2',
  resultHash: 'a'.repeat(64),
  artifactHashes: ['b'.repeat(64)],
  submittedCommit: 'abcdef1'
}

describe('Review execution coordinator', () => {
  it('fans out user-assigned reviewers and aggregates only after quorum', () => {
    const coordinator = new ReviewExecutionCoordinator()
    const panel = coordinator.createPanel(panelRequest())
    expect(panel).toMatchObject({ status: 'collecting', minimumDecisions: 2 })
    expect(panel.assignments).toHaveLength(2)
    expect(panel.assignments.every((assignment) => assignment.status === 'running')).toBe(true)

    const first = coordinator.submit(
      panel,
      reviewerAuthority('a'),
      reviewDecision('a', 'approved'),
      reviewArtifact('a')
    )
    expect(first).toMatchObject({ status: 'collecting' })
    expect(first.assignments.map((assignment) => assignment.status)).toEqual([
      'submitted',
      'running'
    ])
    expect(panel.assignments[0]!.status).toBe('running')

    const aggregated = coordinator.submit(
      first,
      reviewerAuthority('b'),
      reviewDecision('b', 'changes_requested'),
      reviewArtifact('b')
    )
    expect(aggregated).toMatchObject({
      status: 'awaiting_human_decision',
      aggregation: {
        status: 'awaiting_human_decision',
        aggregation: {
          subject: targetSubject,
          classification: 'blocking_disagreement',
          requiresHumanDecision: true
        }
      }
    })
  })

  it('invalidates collected decisions when a new target Attempt or commit appears', () => {
    const coordinator = new ReviewExecutionCoordinator()
    const panel = coordinator.submit(
      coordinator.createPanel({ ...panelRequest(), minimumDecisions: 1 }),
      reviewerAuthority('a'),
      reviewDecision('a', 'approved'),
      reviewArtifact('a')
    )
    expect(coordinator.invalidateIfSuperseded(panel, targetSubject)).toBe(panel)

    const latest = {
      ...targetSubject,
      attemptId: 'attempt.implementation.3',
      resultHash: 'c'.repeat(64),
      submittedCommit: 'bcdefa2'
    }
    const invalidated = coordinator.invalidateIfSuperseded(panel, latest)
    expect(invalidated).toMatchObject({
      status: 'invalidated',
      subject: targetSubject,
      supersededBy: latest
    })
    expect(invalidated.assignments[0]!.decision?.attemptId).toBe(targetSubject.attemptId)
    expect(() =>
      coordinator.submit(
        invalidated,
        reviewerAuthority('b'),
        reviewDecision('b', 'approved'),
        reviewArtifact('b')
      )
    ).toThrow(expect.objectContaining({ code: 'review_panel_closed' }))
  })

  it('rejects unreachable quorum, duplicate reviewers and cross-invocation submissions', () => {
    const coordinator = new ReviewExecutionCoordinator()
    expect(() => coordinator.createPanel({ ...panelRequest(), minimumDecisions: 3 })).toThrow(
      expect.objectContaining({ code: 'review_quorum_unreachable' })
    )
    const duplicate = panelRequest()
    expect(() =>
      coordinator.createPanel({
        ...duplicate,
        reviewers: [duplicate.reviewers[0], duplicate.reviewers[0]]
      })
    ).toThrow(expect.objectContaining({ code: 'duplicate_review_assignment' }))

    const panel = coordinator.createPanel(panelRequest())
    expect(() =>
      coordinator.submit(
        panel,
        { ...reviewerAuthority('a'), executorInvocationId: 'invocation.foreign' },
        reviewDecision('a', 'approved'),
        reviewArtifact('a')
      )
    ).toThrow(expect.objectContaining({ code: 'review_submission_binding_mismatch' }))
    expect(() =>
      coordinator.submit(panel, reviewerAuthority('a'), reviewDecision('a', 'approved'), {
        ...reviewArtifact('a'),
        availability: 'local'
      })
    ).toThrow(expect.objectContaining({ code: 'review_artifact_not_git' }))
  })
})

function panelRequest() {
  return {
    schemaVersion: '1.0.0',
    id: 'review-panel.1',
    workflowRunId: 'run.review',
    reviewNodeId: 'review.node',
    subject: targetSubject,
    minimumDecisions: 2,
    reviewers: [reviewer('a'), reviewer('b')]
  }
}

function reviewer(suffix: string) {
  return {
    reviewerTaskId: `task.review.${suffix}`,
    reviewerAttemptId: `attempt.review.${suffix}`,
    roleProfileId: 'role.reviewer',
    roleProfileVersion: 1,
    roleInstanceId: `role-instance.review.${suffix}`,
    executorInvocationId: `invocation.review.${suffix}`,
    startedAt: '2026-07-28T14:00:00Z'
  }
}

function reviewerAuthority(suffix: string) {
  const binding = reviewer(suffix)
  return {
    reviewerTaskId: binding.reviewerTaskId,
    reviewerAttemptId: binding.reviewerAttemptId,
    roleInstanceId: binding.roleInstanceId,
    executorInvocationId: binding.executorInvocationId,
    completedAt: '2026-07-28T14:05:00Z'
  }
}

function reviewDecision(suffix: string, status: 'approved' | 'changes_requested'): ReviewDecision {
  const binding = reviewer(suffix)
  return {
    schemaVersion: '1.0.0',
    id: `review.decision.${suffix}`,
    workflowRunId: 'run.review',
    reviewNodeId: 'review.node',
    attemptId: targetSubject.attemptId,
    subject: targetSubject,
    reviewerTaskId: binding.reviewerTaskId,
    reviewerAttemptId: binding.reviewerAttemptId,
    reviewerRoleInstanceId: binding.roleInstanceId,
    status,
    findings:
      status === 'changes_requested'
        ? [
            {
              schemaVersion: '1.0.0',
              id: `finding.${suffix}`,
              attemptId: targetSubject.attemptId,
              severity: 'high',
              category: 'correctness',
              summary: 'A correction is required.',
              evidence: []
            }
          ]
        : [],
    summary: status === 'approved' ? 'Approved.' : 'Changes requested.',
    createdAt: '2026-07-28T14:05:00Z'
  }
}

function reviewArtifact(suffix: string): ArtifactVersion {
  const binding = reviewer(suffix)
  return {
    schemaVersion: '1.0.0',
    id: `artifact.review.${suffix}`,
    artifactType: 'artifact.review-report',
    version: 1,
    workflowRunId: 'run.review',
    nodeRunId: 'node-run.review',
    taskId: binding.reviewerTaskId,
    attemptId: binding.reviewerAttemptId,
    roleInstanceId: binding.roleInstanceId,
    format: 'json-schema',
    contentHash: suffix === 'a' ? 'd'.repeat(64) : 'e'.repeat(64),
    byteSize: 500,
    storageRef: `git:mam-state:reviews/${suffix}.json`,
    availability: 'git',
    inputs: [],
    validationStatus: 'valid',
    createdAt: '2026-07-28T14:05:00Z'
  }
}
