import { describe, expect, it } from 'vitest'
import type { MergeQueueEntry } from '../../../shared/mam/domain/merge-queue'
import type { WorkflowDefinition } from '../../../shared/mam/domain/workflow'
import { createWorkflowRunBundle } from './workflow-run-factory'
import {
  createMergeConflictResolution,
  createMergeConflictTask
} from './merge-conflict-task-service'

const hash = 'a'.repeat(64)

describe('Merge conflict Task service', () => {
  it('creates deterministic waiting-assignment lineage for the configured coordinator roles', () => {
    const entry = activeEntry()
    const input = {
      bundle: bundle(),
      entry,
      result: {
        status: 'conflict' as const,
        targetCommitBefore: 'bbbbbbb',
        submittedCommit: entry.submittedCommit,
        mergeBase: 'ccccccc',
        conflictingPaths: ['src/z.ts', 'src/a.ts']
      },
      createdAt: '2026-07-28T18:02:00Z'
    }
    const task = createMergeConflictTask(input)
    expect(task).toMatchObject({
      queueEntryId: entry.id,
      parentTaskId: entry.taskId,
      parentAttemptId: entry.attemptId,
      conflictingPaths: ['src/a.ts', 'src/z.ts'],
      validationCommands: [],
      recommendedRoleProfileIds: ['role.coordinator'],
      allowedRoleProfileIds: ['role.coordinator'],
      initialStatus: 'waiting_role_assignment'
    })
    expect(createMergeConflictTask(input).id).toBe(task.id)
  })

  it('rejects conflict evidence for another submitted revision', () => {
    const entry = activeEntry()
    expect(() =>
      createMergeConflictTask({
        bundle: bundle(),
        entry,
        result: {
          status: 'conflict',
          targetCommitBefore: 'bbbbbbb',
          submittedCommit: 'ddddddd',
          mergeBase: 'ccccccc',
          conflictingPaths: ['src/a.ts']
        },
        createdAt: '2026-07-28T18:02:00Z'
      })
    ).toThrow(expect.objectContaining({ code: 'merge_conflict_lineage_mismatch' }))
  })

  it('converts validated worktree output into immutable resolution evidence', () => {
    const task = createMergeConflictTask({
      bundle: bundle(),
      entry: activeEntry(),
      result: {
        status: 'conflict',
        targetCommitBefore: 'bbbbbbb',
        submittedCommit: 'aaaaaaa',
        mergeBase: 'ccccccc',
        conflictingPaths: ['src/a.ts']
      },
      createdAt: '2026-07-28T18:02:00Z'
    })
    const resolution = createMergeConflictResolution({
      task,
      result: {
        status: 'merged',
        queueEntryId: task.queueEntryId,
        conflictTaskId: task.id,
        resolutionAttemptId: 'attempt.resolution',
        mergeCommit: 'ddddddd',
        completedAt: '2026-07-28T18:10:00Z',
        validations: []
      }
    })
    expect(resolution).toMatchObject({
      workflowRunId: task.workflowRunId,
      queueEntryId: task.queueEntryId,
      conflictTaskId: task.id,
      resolutionAttemptId: 'attempt.resolution',
      mergeCommit: 'ddddddd',
      validationEvidence: {}
    })
  })
})

function activeEntry(): MergeQueueEntry {
  return {
    schemaVersion: '1.0.0',
    id: 'merge-entry.feature',
    workflowRunId: 'run.merge-conflict',
    mergeNodeId: 'merge',
    taskId: 'task.feature',
    attemptId: 'attempt.feature',
    targetBranch: 'develop',
    sourceBranch: 'tasks/feature',
    submittedCommit: 'aaaaaaa',
    resultHash: hash,
    mergeReadyAt: '2026-07-28T18:00:00Z',
    readyRevisionHash: hash,
    reviewDecisionIds: ['review.feature'],
    validationEvidence: {},
    strategy: 'no_ff',
    conflictPolicy: 'coordinator_attempt',
    status: 'merging',
    claimedAt: '2026-07-28T18:01:00Z'
  }
}

function bundle() {
  return createWorkflowRunBundle({
    runId: 'run.merge-conflict',
    definition: workflow(),
    roleCatalog: [{ roleProfileId: 'role.coordinator', roleProfileVersion: 1, contentHash: hash }],
    createdAt: '2026-07-28T17:00:00Z'
  })
}

function workflow(): WorkflowDefinition {
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.merge-conflict',
    name: 'Conflict resolution',
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
        validations: []
      },
      { id: 'finish', type: 'finish', inputs: [] }
    ],
    edges: [{ from: 'merge', to: 'finish' }],
    maxTransitions: 20,
    maxRunCostUsd: 20,
    maxRunDurationSeconds: 3600
  }
}
