import { describe, expect, it } from 'vitest'
import type { MergeQueueEntry } from '../../../shared/mam/domain/merge-queue'
import type { WorkflowDefinition } from '../../../shared/mam/domain/workflow'
import { emptyWorkflowRunProjection } from '../state-store/git-event-projection'
import { createWorkflowRunBundle } from './workflow-run-factory'
import { projectWorkflowRun, taskContextDefinition } from './workflow-run-projection'

const hash = 'a'.repeat(64)

describe('Workflow Run application projection', () => {
  it('opens parallel Role Tasks and completes after both branches pass the join', () => {
    const bundle = createWorkflowRunBundle({
      runId: 'run.parallel-projection',
      definition: parallelWorkflow(),
      roleCatalog: roleCatalog(),
      createdAt: '2026-07-28T03:00:00Z'
    })
    const empty = emptyWorkflowRunProjection(bundle.run.id)
    const initial = projectWorkflowRun(bundle, empty, '2026-07-28T03:00:00Z')
    expect(initial.readyTaskIds).toHaveLength(2)
    for (const taskId of initial.readyTaskIds) {
      expect(taskContextDefinition(bundle, empty, taskId)?.initialStatus).toBe(
        'waiting_role_assignment'
      )
    }

    const completedTasks = Object.fromEntries(
      bundle.taskCatalog.map((task) => [task.id, taskProjection('submitted')])
    )
    const completed = projectWorkflowRun(
      bundle,
      { ...empty, tasks: completedTasks },
      '2026-07-28T03:05:00Z'
    )
    expect(completed.run.status).toBe('completed')
    expect(completed.readyTaskIds).toEqual([])
    expect(completed.nodeRuns.find((node) => node.nodeId === 'build-a')).toMatchObject({
      attemptIds: ['attempt.1'],
      latestAttemptId: 'attempt.1'
    })
    expect(completed.nodeRuns.find((node) => node.nodeId === 'join')?.status).toBe('passed')
    expect(completed.nodeRuns.find((node) => node.nodeId === 'finish')?.status).toBe('passed')
  })

  it('waits at an approval gate and advances only after a user resolution event', () => {
    const bundle = createWorkflowRunBundle({
      runId: 'run.approval-projection',
      definition: approvalWorkflow(),
      roleCatalog: roleCatalog().slice(0, 1),
      createdAt: '2026-07-28T03:00:00Z'
    })
    const empty = emptyWorkflowRunProjection(bundle.run.id)
    const taskId = bundle.taskCatalog[0]!.id
    const afterTask = { ...empty, tasks: { [taskId]: taskProjection('submitted') } }
    const waiting = projectWorkflowRun(bundle, afterTask, '2026-07-28T03:01:00Z')
    expect(waiting.run.status).toBe('waiting_for_approval')
    expect(waiting.nodeRuns.find((node) => node.nodeId === 'approve')?.status).toBe(
      'waiting_for_approval'
    )

    const resolved = projectWorkflowRun(
      bundle,
      {
        ...afterTask,
        resolvedApprovalGates: { approve: { option: 'continue', userId: 'user.owner' } }
      },
      '2026-07-28T03:02:00Z'
    )
    expect(resolved.run.status).toBe('completed')
  })

  it('completes a git_merge node from its immutable merged queue entry', () => {
    const bundle = createWorkflowRunBundle({
      runId: 'run.merge-projection',
      definition: mergeWorkflow(),
      roleCatalog: roleCatalog().slice(0, 1),
      createdAt: '2026-07-28T03:00:00Z'
    })
    const buildTask = bundle.taskCatalog.find((task) => task.nodeId === 'build')!
    expect(bundle.taskCatalog.map((task) => task.nodeId)).toEqual(['build'])
    const projection = projectWorkflowRun(
      bundle,
      {
        ...emptyWorkflowRunProjection(bundle.run.id),
        tasks: { [buildTask.id]: taskProjection('submitted') },
        mergeQueueEntries: {
          'merge-entry.build': mergedEntry(bundle.run.id, buildTask.id)
        }
      },
      '2026-07-28T03:05:00Z'
    )
    expect(projection.nodeRuns.find((node) => node.nodeId === 'merge')?.status).toBe('passed')
    expect(projection.run.status).toBe('completed')
  })
})

function taskProjection(status: 'submitted') {
  return {
    status,
    roleProfileId: 'role.builder-a',
    roleProfileVersion: 1,
    assignedByUserId: 'user.owner',
    activeAttemptIds: [],
    knownAttemptIds: ['attempt.1'],
    reviewIds: [],
    executionWarnings: [],
    lastEventId: 'event.result'
  }
}

function parallelWorkflow(): WorkflowDefinition {
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.parallel-projection',
    name: 'Parallel projection',
    version: 1,
    nodes: [
      { id: 'fan-out', type: 'parallel', branches: ['build-a', 'build-b'] },
      roleNode('build-a', 'role.builder-a'),
      roleNode('build-b', 'role.builder-b'),
      { id: 'join', type: 'join', waitFor: ['build-a', 'build-b'] },
      { id: 'finish', type: 'finish', inputs: [] }
    ],
    edges: [
      { from: 'fan-out', to: 'build-a' },
      { from: 'fan-out', to: 'build-b' },
      { from: 'build-a', to: 'join' },
      { from: 'build-b', to: 'join' },
      { from: 'join', to: 'finish' }
    ],
    maxTransitions: 20,
    maxRunCostUsd: 20,
    maxRunDurationSeconds: 3_600
  }
}

function approvalWorkflow(): WorkflowDefinition {
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.approval-projection',
    name: 'Approval projection',
    version: 1,
    nodes: [
      roleNode('build-a', 'role.builder-a'),
      { id: 'approve', type: 'approval_gate', prompt: 'Continue?', options: ['continue', 'stop'] },
      { id: 'finish', type: 'finish', inputs: [] }
    ],
    edges: [
      { from: 'build-a', to: 'approve' },
      { from: 'approve', to: 'finish' }
    ],
    maxTransitions: 10,
    maxRunCostUsd: 10,
    maxRunDurationSeconds: 3_600
  }
}

function mergeWorkflow(): WorkflowDefinition {
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.merge-projection',
    name: 'Merge projection',
    version: 1,
    nodes: [
      roleNode('build', 'role.builder-a'),
      {
        id: 'merge',
        type: 'git_merge',
        recommendedRoleProfileIds: ['role.builder-a'],
        allowedRoleProfileIds: ['role.builder-a'],
        targetBranch: 'main',
        orderBy: 'merge_ready_at',
        strategy: 'no_ff',
        conflictPolicy: 'coordinator_attempt',
        validations: []
      },
      { id: 'finish', type: 'finish', inputs: [] }
    ],
    edges: [
      { from: 'build', to: 'merge' },
      { from: 'merge', to: 'finish' }
    ],
    maxTransitions: 10,
    maxRunCostUsd: 10,
    maxRunDurationSeconds: 3_600
  }
}

function mergedEntry(workflowRunId: string, taskId: string): MergeQueueEntry {
  return {
    schemaVersion: '1.0.0',
    id: 'merge-entry.build',
    workflowRunId,
    mergeNodeId: 'merge',
    taskId,
    attemptId: 'attempt.1',
    targetBranch: 'main',
    sourceBranch: 'mam/attempt.1',
    submittedCommit: 'b'.repeat(40),
    resultHash: hash,
    mergeReadyAt: '2026-07-28T03:03:00Z',
    readyRevisionHash: hash,
    reviewDecisionIds: [],
    validationEvidence: {},
    strategy: 'no_ff',
    conflictPolicy: 'coordinator_attempt',
    status: 'merged',
    mergeCommit: 'c'.repeat(40)
  }
}

function roleNode(id: string, roleProfileId: string) {
  return {
    id,
    type: 'role_task' as const,
    recommendedRoleProfileIds: [roleProfileId],
    allowedRoleProfileIds: [roleProfileId],
    instruction: `Complete ${id}.`,
    workspaceMode: 'write' as const,
    inputs: [],
    outputs: [
      {
        schemaVersion: '1.0.0' as const,
        artifactType: `artifact.${id}`,
        format: 'diff' as const,
        required: true,
        maxBytes: 1_000_000
      }
    ]
  }
}

function roleCatalog() {
  return [
    { roleProfileId: 'role.builder-a', roleProfileVersion: 1, contentHash: hash },
    { roleProfileId: 'role.builder-b', roleProfileVersion: 1, contentHash: hash }
  ]
}
