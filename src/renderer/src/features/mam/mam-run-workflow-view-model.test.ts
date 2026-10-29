import { describe, expect, it } from 'vitest'
import type { WorkflowDefinition } from '../../../../shared/mam/domain/workflow'
import { mamUiFixtureHash, mamUiRunFixture } from './mam-renderer-snapshot-fixture'
import { runWorkflowCanvasModel } from './mam-run-workflow-view-model'

const definition: WorkflowDefinition = {
  schemaVersion: '1.0.0',
  id: 'workflow.ui',
  name: 'Frozen',
  version: 1,
  nodes: [
    { id: 'producer', type: 'finish', inputs: [] },
    { id: 'consumer', type: 'finish', inputs: [] }
  ],
  edges: [{ from: 'producer', to: 'consumer' }],
  presentation: { schemaVersion: 1, pinnedPositions: { producer: { x: 25, y: 50 } } },
  maxTransitions: 10,
  maxRunCostUsd: 1,
  maxRunDurationSeconds: 60
}

describe('read-only Run workflow model', () => {
  it('uses the frozen definition layout and projected node state', () => {
    const run = mamUiRunFixture()
    run.nodeRuns.push({
      schemaVersion: '1.0.0',
      id: 'node-run.producer',
      nodeId: 'producer',
      attemptIds: [],
      status: 'running'
    })
    const model = runWorkflowCanvasModel(run, definition)
    expect(model.nodes.find((node) => node.id === 'producer')).toMatchObject({
      position: { x: 25, y: 50 },
      data: { status: 'running' }
    })
    expect(model.controlEdges).toHaveLength(1)
    expect(model.dataEdges).toEqual([])
  })

  it('shows an Artifact edge only for an exact current delivery/input match', () => {
    const run = mamUiRunFixture()
    run.nodeRuns.push({
      schemaVersion: '1.0.0',
      id: 'node-run.producer',
      nodeId: 'producer',
      attemptIds: ['attempt.producer'],
      status: 'submitted'
    })
    run.tasks.push({
      id: 'task.producer',
      nodeId: 'producer',
      title: 'Produce',
      kind: 'static',
      status: 'submitted',
      dependencies: [],
      recommendedRoleProfileIds: [],
      allowedRoleProfileIds: [],
      attemptIds: ['attempt.producer'],
      currentDeliveryAttemptId: 'attempt.producer',
      reviewIds: [],
      executionWarningCount: 0,
      outputContracts: [
        {
          schemaVersion: '1.0.0',
          artifactType: 'artifact.input',
          format: 'diff',
          required: true,
          maxBytes: 100
        }
      ]
    })
    run.tasks.push({
      id: 'task.consumer',
      nodeId: 'consumer',
      title: 'Consume',
      kind: 'static',
      status: 'ready',
      dependencies: [],
      recommendedRoleProfileIds: [],
      allowedRoleProfileIds: [],
      attemptIds: [],
      reviewIds: [],
      executionWarningCount: 0,
      inputArtifacts: [{ artifactId: 'artifact.input', version: 1, contentHash: mamUiFixtureHash }]
    })
    run.attempts.push({
      id: 'attempt.producer',
      taskId: 'task.producer',
      status: 'submitted',
      result: {
        schemaVersion: '1.0.0',
        status: 'submitted',
        summary: 'Produced.',
        verifications: [],
        risks: [],
        followUps: [],
        usage: { status: 'unknown' },
        artifacts: [
          {
            contractId: 'artifact.input',
            type: 'artifact.input',
            contentRef: 'out.json',
            sha256: mamUiFixtureHash
          }
        ],
        system: {
          workflowRunId: 'run.ui',
          nodeRunId: 'node-run.producer',
          taskId: 'task.producer',
          attemptId: 'attempt.producer',
          roleInstanceId: 'role-instance.producer',
          executorInvocationId: 'invocation.producer',
          effectiveConfigHash: mamUiFixtureHash,
          createdAt: '2026-07-28T18:00:00Z'
        }
      }
    })
    expect(runWorkflowCanvasModel(run, definition).dataEdges).toMatchObject([
      { source: 'producer', target: 'consumer', label: 'artifact.input · 引用匹配' }
    ])
  })
})
