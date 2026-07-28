import { describe, expect, it } from 'vitest'
import type { WorkflowDefinition } from '../../../shared/mam/domain/workflow'
import { SchedulerKernel } from '../scheduler/kernel'
import { applyEvent } from '../state-store/git-event-application'
import { emptyWorkflowRunProjection } from '../state-store/git-state-projection'
import { createWorkflowRunBundle } from './workflow-run-factory'
import { projectWorkflowRun, taskContextDefinition } from './workflow-run-projection'

const hash = 'a'.repeat(64)

describe('condition route resolution', () => {
  it('persists one selected branch and cancels the unselected Task without blocking the join', () => {
    const bundle = createWorkflowRunBundle({
      runId: 'run.condition',
      definition: conditionWorkflow(),
      roleCatalog: [{ roleProfileId: 'role.builder', roleProfileVersion: 1, contentHash: hash }],
      createdAt: '2026-07-28T23:00:00Z'
    })
    const startTask = bundle.taskCatalog.find((task) => task.nodeId === 'start')!
    const yesTask = bundle.taskCatalog.find((task) => task.nodeId === 'yes')!
    const noTask = bundle.taskCatalog.find((task) => task.nodeId === 'no')!
    const before = {
      ...emptyWorkflowRunProjection(bundle.run.id),
      tasks: { [startTask.id]: taskProjection('submitted') }
    }
    expect(projectWorkflowRun(bundle, before, '2026-07-28T23:01:00Z').nodeRuns).toContainEqual(
      expect.objectContaining({ nodeId: 'decide', status: 'ready' })
    )

    const batch = new SchedulerKernel().execute(
      {
        schemaVersion: '1.0.0',
        commandId: 'command.resolve-condition',
        issuedAt: '2026-07-28T23:01:00Z',
        workflowRunId: bundle.run.id,
        actor: { kind: 'scheduler', schedulerId: 'scheduler.desktop' },
        type: 'resolve_condition',
        nodeId: 'decide',
        selectedBranch: 'yes'
      },
      {
        schedulerId: 'scheduler.desktop',
        runBundle: bundle,
        resolvedConditionNodeIds: new Set(),
        nodeStatuses: new Map([['decide', 'ready']]),
        validArtifactHashes: new Set(),
        processedCommandIds: new Set(),
        mergeQueueEntries: new Map()
      }
    )
    const resolved = applyEvent(before, batch.events[0]!)
    const snapshot = projectWorkflowRun(bundle, resolved, '2026-07-28T23:01:01Z')

    expect(snapshot.nodeRuns).toContainEqual(
      expect.objectContaining({ nodeId: 'yes', status: 'waiting_role_assignment' })
    )
    expect(snapshot.nodeRuns).toContainEqual(
      expect.objectContaining({ nodeId: 'no', status: 'cancelled' })
    )
    expect(taskContextDefinition(bundle, resolved, noTask.id)?.initialStatus).toBe(
      'waiting_dependencies'
    )
    expect(snapshot.readyTaskIds).toContain(yesTask.id)
    expect(snapshot.readyTaskIds).not.toContain(noTask.id)

    const completed = projectWorkflowRun(
      bundle,
      { ...resolved, tasks: { ...resolved.tasks, [yesTask.id]: taskProjection('submitted') } },
      '2026-07-28T23:02:00Z'
    )
    expect(completed.nodeRuns).toContainEqual(
      expect.objectContaining({ nodeId: 'join', status: 'passed' })
    )
    expect(completed.run.status).toBe('completed')
  })
})

function conditionWorkflow(): WorkflowDefinition {
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.condition',
    name: 'Condition route',
    version: 1,
    nodes: [
      roleNode('start'),
      {
        id: 'decide',
        type: 'condition',
        expression: 'approved',
        branches: { yes: 'yes', no: 'no' }
      },
      roleNode('yes'),
      roleNode('no'),
      { id: 'join', type: 'join', waitFor: ['yes', 'no'] },
      { id: 'finish', type: 'finish', inputs: [] }
    ],
    edges: [
      { from: 'start', to: 'decide' },
      { from: 'decide', to: 'yes' },
      { from: 'decide', to: 'no' },
      { from: 'yes', to: 'join' },
      { from: 'no', to: 'join' },
      { from: 'join', to: 'finish' }
    ],
    maxTransitions: 20,
    maxRunCostUsd: 10,
    maxRunDurationSeconds: 3_600
  }
}

function roleNode(id: string) {
  return {
    id,
    type: 'role_task' as const,
    recommendedRoleProfileIds: ['role.builder'],
    allowedRoleProfileIds: ['role.builder'],
    instruction: `Complete ${id}.`,
    workspaceMode: 'none' as const,
    inputs: [],
    outputs: [
      {
        schemaVersion: '1.0.0' as const,
        artifactType: `artifact.${id}`,
        format: 'json-schema' as const,
        required: true,
        maxBytes: 1_000,
        jsonSchema: { type: 'object' }
      }
    ]
  }
}

function taskProjection(status: 'submitted') {
  return {
    status,
    roleProfileId: 'role.builder',
    roleProfileVersion: 1,
    assignedByUserId: 'user.owner',
    activeAttemptIds: [],
    knownAttemptIds: ['attempt.1'],
    reviewIds: [],
    executionWarnings: [],
    lastEventId: 'event.result'
  }
}
