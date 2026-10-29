import { describe, expect, it } from 'vitest'
import type { WorkflowDefinition } from '../../../../shared/mam/domain/workflow'
import { mamUiRunFixture, mamUiFixtureHash } from './mam-renderer-snapshot-fixture'
import { boundArtifactFlows } from './mam-workflow-bound-artifact-flows'

const hash = mamUiFixtureHash
const definition: WorkflowDefinition = {
  schemaVersion: '1.0.0',
  id: 'workflow.ui',
  name: 'Flow',
  version: 1,
  nodes: [
    { id: 'producer', type: 'finish', inputs: [] },
    { id: 'consumer', type: 'finish', inputs: [] }
  ],
  edges: [{ from: 'producer', to: 'consumer' }],
  maxTransitions: 10,
  maxRunCostUsd: 1,
  maxRunDurationSeconds: 60
}

function runWithBoundInput() {
  const run = mamUiRunFixture()
  run.nodeRuns.push({
    schemaVersion: '1.0.0',
    id: 'node-run.producer',
    nodeId: 'producer',
    attemptIds: ['attempt.producer'],
    latestAttemptId: 'attempt.producer',
    status: 'submitted'
  })
  run.nodeRuns.push({
    schemaVersion: '1.0.0',
    id: 'node-run.consumer',
    nodeId: 'consumer',
    attemptIds: [],
    status: 'ready'
  })
  run.tasks.push({
    id: 'task.producer',
    nodeId: 'producer',
    title: 'Produce',
    kind: 'static',
    status: 'submitted',
    outputContracts: [
      {
        schemaVersion: '1.0.0',
        artifactType: 'artifact.input',
        format: 'diff',
        required: true,
        maxBytes: 100
      }
    ],
    dependencies: [],
    recommendedRoleProfileIds: [],
    allowedRoleProfileIds: [],
    attemptIds: ['attempt.producer'],
    currentDeliveryAttemptId: 'attempt.producer',
    reviewIds: [],
    executionWarningCount: 0
  })
  run.tasks.push({
    id: 'task.consumer',
    nodeId: 'consumer',
    title: 'Consume',
    kind: 'static',
    status: 'ready',
    inputArtifacts: [{ artifactId: 'artifact.input', version: 1, contentHash: hash }],
    dependencies: [],
    recommendedRoleProfileIds: [],
    allowedRoleProfileIds: [],
    attemptIds: [],
    reviewIds: [],
    executionWarningCount: 0
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
      artifacts: [
        {
          contractId: 'artifact.input',
          type: 'artifact.input',
          contentRef: 'out.json',
          sha256: hash
        }
      ],
      usage: { status: 'unknown' },
      system: {
        workflowRunId: 'run.ui',
        nodeRunId: 'node-run.producer',
        taskId: 'task.producer',
        attemptId: 'attempt.producer',
        roleInstanceId: 'role-instance.producer',
        executorInvocationId: 'invocation.producer',
        effectiveConfigHash: hash,
        createdAt: '2026-07-28T18:00:00Z'
      }
    }
  })
  return run
}

describe('bound Artifact flow', () => {
  it('marks only an exact current Formal Delivery claim bound to a frozen consumer input', () => {
    const flows = boundArtifactFlows(runWithBoundInput(), definition)
    expect(flows).toMatchObject([
      {
        status: 'bound',
        producerNodeId: 'producer',
        consumerNodeId: 'consumer',
        sourceAttemptId: 'attempt.producer'
      }
    ])
  })

  it('does not claim a historical or hash-mismatched delivery as bound', () => {
    const run = runWithBoundInput()
    run.tasks[0]!.currentDeliveryAttemptId = 'attempt.other'
    expect(boundArtifactFlows(run, definition)[0]?.status).toBe('external')
    run.tasks[0]!.currentDeliveryAttemptId = 'attempt.producer'
    run.tasks[1]!.inputArtifacts![0]!.contentHash = 'b'.repeat(64)
    expect(boundArtifactFlows(run, definition)[0]?.status).toBe('external')
  })

  it('does not bind a matching hash from a node outside the producer ancestry', () => {
    const run = runWithBoundInput()
    run.nodeRuns[0]!.nodeId = 'unrelated'
    expect(boundArtifactFlows(run, definition)[0]?.status).toBe('external')
  })
})
