import { describe, expect, it } from 'vitest'
import type { MergeQueueEntry } from '../../../shared/mam/domain/merge-queue'
import type { MergeConflictTaskDefinition } from '../../../shared/mam/domain/merge-conflict-task'
import type { MergeConflictResolution } from '../../../shared/mam/domain/merge-conflict-task'
import { buildAttemptResult } from '../artifacts/attempt-result-builder'
import { SchedulerKernel } from '../scheduler/kernel'
import { applyEvent } from './git-event-application'
import {
  emptyWorkflowRunProjection,
  schedulerContextFromProjection,
  type WorkflowRunProjection
} from './git-event-projection'

const hash = 'a'.repeat(64)

describe('Merge Queue event flow', () => {
  it('persists enqueue, stable claim, and merge outcome transitions', () => {
    const kernel = new SchedulerKernel()
    const taskA = readyEntry('task.a', '2026-07-28T18:01:00Z')
    const taskB = readyEntry('task.b', '2026-07-28T18:00:00Z')
    let projection = approvedProjection(taskA)
    projection = applyEvent(
      projection,
      kernel.execute(markReadyCommand(taskA), taskContext(projection, taskA)).events[0]!
    )
    projection = {
      ...projection,
      mergeQueueEntries: { ...projection.mergeQueueEntries, [taskB.id]: taskB }
    }

    expect(() =>
      kernel.execute(
        claimCommand(taskA.id),
        schedulerContextFromProjection(projection, baseContext())
      )
    ).toThrow(expect.objectContaining({ code: 'merge_queue_order_violation' }))

    projection = applyEvent(
      projection,
      kernel.execute(
        claimCommand(taskB.id),
        schedulerContextFromProjection(projection, baseContext())
      ).events[0]!
    )
    expect(projection.mergeQueueEntries[taskB.id]).toMatchObject({
      status: 'merging',
      claimedAt: '2026-07-28T18:02:00Z'
    })
    expect(() =>
      kernel.execute(
        claimCommand(taskA.id),
        schedulerContextFromProjection(projection, baseContext())
      )
    ).toThrow(expect.objectContaining({ code: 'merge_already_running' }))

    projection = applyEvent(
      projection,
      kernel.execute(
        outcomeCommand(taskB.id),
        schedulerContextFromProjection(projection, baseContext())
      ).events[0]!
    )
    expect(projection.mergeQueueEntries[taskB.id]).toMatchObject({
      status: 'merged',
      mergeCommit: 'merged01',
      completedAt: '2026-07-28T18:03:00Z'
    })
  })

  it('authorizes an exact promotion candidate after the reviewed Task completed integration', () => {
    const entry = {
      ...readyEntry('task.a', '2026-07-28T18:04:00Z'),
      id: 'merge-entry.promote-task.a',
      mergeNodeId: 'promote',
      targetBranch: 'main'
    }
    const approved = approvedProjection(entry)
    const projection = {
      ...approved,
      tasks: {
        ...approved.tasks,
        'task.a': { ...approved.tasks['task.a']!, status: 'completed' as const }
      }
    }

    expect(
      new SchedulerKernel().execute(markReadyCommand(entry), taskContext(projection, entry))
        .events[0]
    ).toMatchObject({ type: 'merge_ready_recorded', entry })
  })

  it('supersedes a queued revision when a newer Attempt submits another commit', () => {
    const entry = readyEntry('task.a', '2026-07-28T18:01:00Z')
    const projection = applyEvent(approvedProjection(entry, true), newResultEvent('replacement01'))
    expect(projection.mergeQueueEntries[entry.id]).toMatchObject({
      status: 'superseded',
      supersededByCommit: 'replacement01',
      supersededAt: '2026-07-28T18:04:00Z'
    })
  })

  it('persists an assignable conflict Task with exact queue lineage', () => {
    const kernel = new SchedulerKernel()
    const entry = {
      ...readyEntry('task.a', '2026-07-28T18:01:00Z'),
      status: 'merging' as const,
      claimedAt: '2026-07-28T18:01:30Z'
    }
    let projection: WorkflowRunProjection = {
      ...approvedProjection(entry),
      mergeQueueEntries: { [entry.id]: entry }
    }
    const conflictTask = mergeConflictTask(entry)
    projection = applyEvent(
      projection,
      kernel.execute(
        conflictOutcomeCommand(entry.id, conflictTask),
        schedulerContextFromProjection(projection, baseContext())
      ).events[0]!
    )

    expect(projection.mergeQueueEntries[entry.id]).toMatchObject({
      status: 'conflict',
      conflictTaskId: conflictTask.id
    })
    expect(projection.mergeConflictTasks[conflictTask.id]).toEqual(conflictTask)
  })

  it('completes a conflict only from the verified submitted resolution Attempt', () => {
    const entry = {
      ...readyEntry('task.a', '2026-07-28T18:01:00Z'),
      status: 'conflict' as const,
      claimedAt: '2026-07-28T18:01:30Z',
      detectedAt: '2026-07-28T18:03:00Z',
      conflictTaskId: 'merge-conflict-task.a'
    }
    const conflictTask = mergeConflictTask(entry)
    const resolution = conflictResolution(entry, conflictTask)
    let projection: WorkflowRunProjection = resolutionProjection(entry, conflictTask, resolution)
    const command = {
      ...envelope('command.resolution', resolution.completedAt),
      type: 'record_merge_conflict_resolution',
      taskId: conflictTask.id,
      attemptId: resolution.resolutionAttemptId,
      resolution
    }
    const context = schedulerContextFromProjection(projection, {
      ...baseContext(),
      taskId: conflictTask.id,
      taskDefinition: {
        initialStatus: 'waiting_role_assignment',
        allowedRoleProfileIds: conflictTask.allowedRoleProfileIds,
        roleCatalogVersions: new Map([['role.coordinator', new Set([1])]]),
        mergeResolutionCandidate: resolution
      }
    })
    projection = applyEvent(projection, new SchedulerKernel().execute(command, context).events[0]!)

    expect(projection.mergeQueueEntries[entry.id]).toMatchObject({
      status: 'merged',
      resolutionAttemptId: resolution.resolutionAttemptId,
      mergeCommit: resolution.mergeCommit
    })
    expect(projection.mergeConflictResolutions[resolution.id]).toEqual(resolution)
    expect(projection.tasks[conflictTask.id]?.status).toBe('completed')
  })
})

function approvedProjection(entry: MergeQueueEntry, includeEntry = false): WorkflowRunProjection {
  const empty = emptyWorkflowRunProjection('run.merge')
  return {
    ...empty,
    tasks: {
      'task.a': {
        status: 'approved',
        roleProfileId: 'role.developer',
        roleProfileVersion: 1,
        activeAttemptIds: includeEntry ? ['attempt.new'] : [],
        knownAttemptIds: ['attempt.old', ...(includeEntry ? ['attempt.new'] : [])],
        selectedAttemptId: 'attempt.old',
        reviewIds: ['review.a'],
        executionWarnings: [],
        lastEventId: 'event.approved'
      }
    },
    attempts: includeEntry
      ? {
          'attempt.new': {
            taskId: 'task.a',
            status: 'running',
            roleInstanceId: 'role-instance.new',
            executorInvocationId: 'invocation.new',
            effectiveConfigHash: hash,
            lastEventId: 'event.started'
          }
        }
      : {},
    mergeQueueEntries: includeEntry ? { [entry.id]: entry } : {}
  }
}

function taskContext(projection: WorkflowRunProjection, entry: MergeQueueEntry) {
  return schedulerContextFromProjection(projection, {
    ...baseContext(),
    taskId: entry.taskId,
    taskDefinition: {
      initialStatus: 'waiting_dependencies',
      allowedRoleProfileIds: ['role.developer'],
      roleCatalogVersions: new Map([['role.developer', new Set([1])]]),
      mergeCandidate: entry
    }
  })
}

function baseContext() {
  return { schedulerId: 'scheduler.1' }
}

function readyEntry(taskId: string, mergeReadyAt: string): MergeQueueEntry {
  return {
    schemaVersion: '1.0.0',
    id: `merge-entry.${taskId}`,
    workflowRunId: 'run.merge',
    mergeNodeId: 'merge',
    taskId,
    attemptId: `attempt.${taskId}`,
    targetBranch: 'develop',
    sourceBranch: `tasks/${taskId}`,
    submittedCommit: `commit-${taskId}`,
    resultHash: hash,
    mergeReadyAt,
    readyRevisionHash: hash,
    reviewDecisionIds: [`review.${taskId}`],
    validationEvidence: { 'pnpm test': hash },
    strategy: 'no_ff',
    conflictPolicy: 'coordinator_attempt',
    status: 'queued'
  }
}

function envelope(commandId: string, issuedAt = '2026-07-28T18:02:00Z') {
  return {
    schemaVersion: '1.0.0' as const,
    commandId,
    issuedAt,
    workflowRunId: 'run.merge',
    actor: { kind: 'scheduler' as const, schedulerId: 'scheduler.1' }
  }
}

function markReadyCommand(entry: MergeQueueEntry) {
  return { ...envelope('command.ready'), type: 'mark_merge_ready', taskId: entry.taskId, entry }
}

function claimCommand(entryId: string) {
  return {
    ...envelope(`command.claim.${entryId}`),
    type: 'claim_merge_entry',
    entryId,
    claimedAt: '2026-07-28T18:02:00Z'
  }
}

function outcomeCommand(entryId: string) {
  return {
    ...envelope(`command.outcome.${entryId}`, '2026-07-28T18:03:00Z'),
    type: 'record_merge_outcome',
    entryId,
    outcome: {
      status: 'merged',
      mergeCommit: 'merged01',
      completedAt: '2026-07-28T18:03:00Z'
    }
  }
}

function conflictOutcomeCommand(entryId: string, conflictTask: MergeConflictTaskDefinition) {
  return {
    ...envelope(`command.conflict.${entryId}`, conflictTask.createdAt),
    type: 'record_merge_outcome',
    entryId,
    outcome: { status: 'conflict', conflictTask }
  }
}

function mergeConflictTask(entry: MergeQueueEntry): MergeConflictTaskDefinition {
  return {
    schemaVersion: '1.0.0',
    id: 'merge-conflict-task.a',
    workflowRunId: entry.workflowRunId,
    mergeNodeId: entry.mergeNodeId,
    queueEntryId: entry.id,
    parentTaskId: entry.taskId,
    parentAttemptId: entry.attemptId,
    targetBranch: entry.targetBranch,
    sourceBranch: entry.sourceBranch,
    targetCommit: 'target01',
    submittedCommit: entry.submittedCommit,
    mergeBase: 'base0001',
    conflictingPaths: ['src/a.ts'],
    validationCommands: ['pnpm test'],
    recommendedRoleProfileIds: ['role.coordinator'],
    allowedRoleProfileIds: ['role.coordinator'],
    initialStatus: 'waiting_role_assignment',
    createdAt: '2026-07-28T18:03:00Z'
  }
}

function conflictResolution(
  entry: MergeQueueEntry,
  task: MergeConflictTaskDefinition
): MergeConflictResolution {
  return {
    schemaVersion: '1.0.0',
    id: 'merge-conflict-resolution.a',
    workflowRunId: entry.workflowRunId,
    queueEntryId: entry.id,
    conflictTaskId: task.id,
    resolutionAttemptId: 'attempt.resolution.a',
    mergeCommit: 'resolved01',
    validationEvidence: { 'pnpm test': hash },
    completedAt: '2026-07-28T18:10:00Z'
  }
}

function resolutionProjection(
  entry: MergeQueueEntry,
  conflictTask: MergeConflictTaskDefinition,
  resolution: MergeConflictResolution
): WorkflowRunProjection {
  const empty = emptyWorkflowRunProjection(entry.workflowRunId)
  const result = buildAttemptResult(
    {
      schemaVersion: '1.0.0',
      status: 'submitted',
      summary: 'Conflict resolved.',
      verifications: [],
      risks: [],
      followUps: [],
      artifacts: [],
      usage: { status: 'unknown' }
    },
    {
      workflowRunId: entry.workflowRunId,
      nodeRunId: 'node-run.merge',
      taskId: conflictTask.id,
      attemptId: resolution.resolutionAttemptId,
      roleInstanceId: 'role-instance.coordinator',
      executorInvocationId: 'invocation.coordinator',
      effectiveConfigHash: hash,
      submittedCommit: resolution.mergeCommit,
      createdAt: resolution.completedAt
    }
  )
  return {
    ...empty,
    tasks: {
      [conflictTask.id]: {
        status: 'submitted',
        roleProfileId: 'role.coordinator',
        roleProfileVersion: 1,
        activeAttemptIds: [],
        knownAttemptIds: [resolution.resolutionAttemptId],
        selectedAttemptId: resolution.resolutionAttemptId,
        reviewIds: [],
        executionWarnings: [],
        lastEventId: 'event.resolution-result'
      }
    },
    attempts: {
      [resolution.resolutionAttemptId]: {
        taskId: conflictTask.id,
        status: 'submitted',
        result,
        lastEventId: 'event.resolution-result'
      }
    },
    mergeQueueEntries: { [entry.id]: entry },
    mergeConflictTasks: { [conflictTask.id]: conflictTask }
  }
}

function newResultEvent(submittedCommit: string) {
  const result = buildAttemptResult(
    {
      schemaVersion: '1.0.0',
      status: 'submitted',
      summary: 'New revision.',
      verifications: [],
      risks: [],
      followUps: [],
      artifacts: [],
      usage: { status: 'unknown' }
    },
    {
      workflowRunId: 'run.merge',
      nodeRunId: 'node-run.a',
      taskId: 'task.a',
      attemptId: 'attempt.new',
      roleInstanceId: 'role-instance.new',
      executorInvocationId: 'invocation.new',
      effectiveConfigHash: hash,
      submittedCommit,
      createdAt: '2026-07-28T18:04:00Z'
    }
  )
  return {
    schemaVersion: '1.0.0' as const,
    eventId: 'event.result.new',
    commandId: 'command.result.new',
    createdAt: '2026-07-28T18:04:00Z',
    workflowRunId: 'run.merge',
    schedulerId: 'scheduler.1',
    parentRevision: hash,
    type: 'attempt_result_submitted' as const,
    taskId: 'task.a',
    attemptId: 'attempt.new',
    result
  }
}
