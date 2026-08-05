import { describe, expect, it } from 'vitest'
import type { ReviewDecision } from '../../../shared/mam/domain/review'
import type { WorkflowDefinition } from '../../../shared/mam/domain/workflow'
import { buildAttemptResult } from '../artifacts/attempt-result-builder'
import { emptyWorkflowRunProjection } from '../state-store/git-event-projection'
import type { WorkflowRunProjection } from '../state-store/git-state-projection'
import { profileContentHash } from '../profiles/profile-content-hash'
import { createMergeQueueEntry, MergeQueue } from './merge-queue-service'
import { createWorkflowRunBundle } from './workflow-run-factory'

const hash = 'a'.repeat(64)

describe('Merge Queue service', () => {
  it('sorts immutable ready revisions by mergeReadyAt then taskId and claims only one', () => {
    const bundle = mergeBundle()
    const projection = mergeProjection(['task.b', 'task.a', 'task.c'])
    const entries = [
      readyEntry(bundle, projection, 'task.b', '2026-07-28T18:01:00Z'),
      readyEntry(bundle, projection, 'task.a', '2026-07-28T18:01:00Z'),
      readyEntry(bundle, projection, 'task.c', '2026-07-28T18:00:00Z')
    ]
    const queue = MergeQueue.create(entries)
    expect(queue.list().map((entry) => entry.taskId)).toEqual(['task.c', 'task.a', 'task.b'])

    const claimed = queue.claimNext('2026-07-28T18:02:00Z')
    expect(claimed.entry).toMatchObject({ taskId: 'task.c', status: 'merging' })
    expect(() => claimed.queue.claimNext('2026-07-28T18:03:00Z')).toThrow(
      expect.objectContaining({ code: 'merge_already_running' })
    )
    const merged = claimed.queue.markMerged(claimed.entry!.id, 'fedcba9', '2026-07-28T18:04:00Z')
    expect(merged.claimNext('2026-07-28T18:05:00Z').entry?.taskId).toBe('task.a')
  })

  it('supersedes an old ready revision when the Task produces another commit', () => {
    const bundle = mergeBundle()
    const projection = mergeProjection(['task.a'])
    const original = readyEntry(bundle, projection, 'task.a', '2026-07-28T18:01:00Z')
    const superseded = MergeQueue.create([original]).supersedeTask(
      'task.a',
      '1234567',
      '2026-07-28T18:02:00Z'
    )
    expect(superseded.list()[0]).toMatchObject({
      status: 'superseded',
      submittedCommit: 'commit-task.a',
      supersededByCommit: '1234567'
    })
    expect(superseded.claimNext('2026-07-28T18:02:00Z').entry).toBeUndefined()
  })

  it('rejects stale Review subjects and incomplete validation evidence', () => {
    const bundle = mergeBundle()
    const projection = mergeProjection(['task.a'])
    expect(() =>
      createMergeQueueEntry({
        bundle,
        projection,
        mergeNodeId: 'merge',
        taskId: 'task.a',
        sourceBranch: 'tasks/task.a',
        mergeReadyAt: '2026-07-28T18:01:00Z',
        validationEvidence: {}
      })
    ).toThrow(expect.objectContaining({ code: 'merge_validation_incomplete' }))
    expect(() =>
      createMergeQueueEntry({
        bundle,
        projection: {
          ...projection,
          reviewAggregations: {
            ...projection.reviewAggregations,
            'aggregation.task.a': {
              ...projection.reviewAggregations['aggregation.task.a']!,
              subject: {
                ...projection.reviewAggregations['aggregation.task.a']!.subject,
                resultHash: 'f'.repeat(64)
              }
            }
          }
        },
        mergeNodeId: 'merge',
        taskId: 'task.a',
        sourceBranch: 'tasks/task.a',
        mergeReadyAt: '2026-07-28T18:01:00Z',
        validationEvidence: { 'pnpm test': hash }
      })
    ).toThrow(expect.objectContaining({ code: 'merge_revision_mismatch' }))
  })

  it('promotes the merged develop revision into main', () => {
    const bundle = mergeBundle()
    const projection = mergeProjection(['task.a'])
    const develop = readyEntry(bundle, projection, 'task.a', '2026-07-28T18:01:00Z')
    const mergedDevelop = {
      ...develop,
      status: 'merged' as const,
      mergeCommit: 'abcdef1',
      completedAt: '2026-07-28T18:02:00Z'
    }
    const promoted = createMergeQueueEntry({
      bundle,
      projection: {
        ...projection,
        tasks: {
          ...projection.tasks,
          'task.a': { ...projection.tasks['task.a']!, status: 'completed' }
        },
        mergeQueueEntries: { [mergedDevelop.id]: mergedDevelop }
      },
      mergeNodeId: 'promote',
      taskId: 'task.a',
      sourceBranch: 'ignored-task-branch',
      mergeReadyAt: '2026-07-28T18:03:00Z',
      validationEvidence: {}
    })

    expect(promoted).toMatchObject({
      targetBranch: 'main',
      sourceBranch: 'develop',
      submittedCommit: 'abcdef1'
    })
  })

  it('does not treat an unpromoted completed Task as newly approved', () => {
    const bundle = mergeBundle()
    const projection = mergeProjection(['task.a'])
    expect(() =>
      createMergeQueueEntry({
        bundle,
        projection: {
          ...projection,
          tasks: {
            ...projection.tasks,
            'task.a': { ...projection.tasks['task.a']!, status: 'completed' }
          }
        },
        mergeNodeId: 'merge',
        taskId: 'task.a',
        sourceBranch: 'tasks/task.a',
        mergeReadyAt: '2026-07-28T18:03:00Z',
        validationEvidence: { 'pnpm test': hash }
      })
    ).toThrow(expect.objectContaining({ code: 'merge_review_required' }))
  })
})

function readyEntry(
  bundle: ReturnType<typeof mergeBundle>,
  projection: WorkflowRunProjection,
  taskId: string,
  mergeReadyAt: string
) {
  return createMergeQueueEntry({
    bundle,
    projection,
    mergeNodeId: 'merge',
    taskId,
    sourceBranch: `tasks/${taskId}`,
    mergeReadyAt,
    validationEvidence: { 'pnpm test': hash }
  })
}

function mergeProjection(taskIds: string[]): WorkflowRunProjection {
  const empty = emptyWorkflowRunProjection('run.merge')
  const tasks: Record<string, WorkflowRunProjection['tasks'][string]> = {}
  const attempts: Record<string, WorkflowRunProjection['attempts'][string]> = {}
  const reviews: Record<string, WorkflowRunProjection['reviews'][string]> = {}
  const reviewValidity: Record<string, WorkflowRunProjection['reviewValidity'][string]> = {}
  const reviewAggregations: Record<string, WorkflowRunProjection['reviewAggregations'][string]> = {}
  for (const taskId of taskIds) {
    const attemptId = `attempt.${taskId}`
    const result = attemptResult(taskId, attemptId)
    const resultHash = profileContentHash(result)
    const review = reviewDecision(taskId, attemptId, resultHash)
    tasks[taskId] = {
      status: 'approved',
      roleProfileId: 'role.developer',
      roleProfileVersion: 1,
      assignedByUserId: 'user.owner',
      activeAttemptIds: [],
      knownAttemptIds: [attemptId],
      selectedAttemptId: attemptId,
      reviewIds: [review.id],
      executionWarnings: [],
      lastEventId: `event.review.${taskId}`
    }
    attempts[attemptId] = {
      taskId,
      status: 'submitted',
      result,
      lastEventId: `event.result.${taskId}`
    }
    reviews[review.id] = review
    reviewValidity[review.id] = { status: 'valid' }
    reviewAggregations[`aggregation.${taskId}`] = {
      schemaVersion: '1.0.0',
      id: `aggregation.${taskId}`,
      workflowRunId: 'run.merge',
      reviewNodeId: 'review',
      attemptId,
      subject: review.subject,
      classification: 'consensus',
      sourceDecisionIds: [review.id],
      findings: [],
      proposedStatus: 'approved',
      requiresHumanDecision: false,
      createdAt: '2026-07-28T18:00:00Z'
    }
  }
  return { ...empty, tasks, attempts, reviews, reviewValidity, reviewAggregations }
}

function attemptResult(taskId: string, attemptId: string) {
  return buildAttemptResult(
    {
      schemaVersion: '1.0.0',
      status: 'submitted',
      summary: 'Ready to merge.',
      verifications: [],
      risks: [],
      followUps: [],
      artifacts: [],
      usage: { status: 'unknown' }
    },
    {
      workflowRunId: 'run.merge',
      nodeRunId: `node-run.${taskId}`,
      taskId,
      attemptId,
      roleInstanceId: `role-instance.${taskId}`,
      executorInvocationId: `invocation.${taskId}`,
      effectiveConfigHash: hash,
      submittedCommit: `commit-${taskId}`,
      createdAt: '2026-07-28T17:55:00Z'
    }
  )
}

function reviewDecision(taskId: string, attemptId: string, resultHash: string): ReviewDecision {
  return {
    schemaVersion: '1.0.0',
    id: `review.${taskId}`,
    workflowRunId: 'run.merge',
    reviewNodeId: 'review',
    attemptId,
    subject: {
      taskId,
      attemptId,
      resultHash,
      artifactHashes: [],
      submittedCommit: `commit-${taskId}`
    },
    reviewerTaskId: `review-task.${taskId}`,
    reviewerAttemptId: `review-attempt.${taskId}`,
    reviewerRoleInstanceId: `reviewer.${taskId}`,
    status: 'approved',
    findings: [],
    summary: 'Approved.',
    createdAt: '2026-07-28T18:00:00Z'
  }
}

function mergeBundle() {
  return createWorkflowRunBundle({
    runId: 'run.merge',
    definition: mergeWorkflow(),
    roleCatalog: [{ roleProfileId: 'role.coordinator', roleProfileVersion: 1, contentHash: hash }],
    createdAt: '2026-07-28T17:00:00Z'
  })
}

function mergeWorkflow(): WorkflowDefinition {
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.merge',
    name: 'Merge Queue',
    version: 1,
    nodes: [
      {
        id: 'merge',
        type: 'git_merge',
        recommendedRoleProfileIds: ['role.coordinator'],
        allowedRoleProfileIds: ['role.coordinator'],
        targetBranch: 'develop',
        orderBy: 'merge_ready_at',
        strategy: 'no_ff',
        conflictPolicy: 'coordinator_attempt',
        validations: ['pnpm test']
      },
      { id: 'approve', type: 'approval_gate', prompt: 'Promote?', options: ['promote'] },
      {
        id: 'promote',
        type: 'git_merge',
        recommendedRoleProfileIds: ['role.coordinator'],
        allowedRoleProfileIds: ['role.coordinator'],
        targetBranch: 'main',
        orderBy: 'merge_ready_at',
        strategy: 'no_ff',
        conflictPolicy: 'coordinator_attempt',
        validations: []
      },
      { id: 'finish', type: 'finish', inputs: [] }
    ],
    edges: [
      { from: 'merge', to: 'approve' },
      { from: 'approve', to: 'promote' },
      { from: 'promote', to: 'finish' }
    ],
    maxTransitions: 20,
    maxRunCostUsd: 20,
    maxRunDurationSeconds: 3600
  }
}
