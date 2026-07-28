import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { WorkflowRunProjection } from '../state-store/git-state-projection'
import { emptyWorkflowRunProjection } from '../state-store/git-state-projection'
import { readUpstreamArtifacts } from './workflow-node-artifact-context'
import { createWorkflowRunBundle } from './workflow-run-factory'

const hash = 'a'.repeat(64)

describe('condition Artifact context', () => {
  it('reads and verifies structured output from the submitted Git commit', () => {
    const bundle = createWorkflowRunBundle({
      runId: 'run.condition-artifacts',
      definition: definition(),
      roleCatalog: [{ roleProfileId: 'role.builder', roleProfileVersion: 1, contentHash: hash }],
      createdAt: '2026-07-28T23:00:00Z'
    })
    const sourceTask = bundle.taskCatalog[0]!
    const bytes = '{"approved":true}\n'
    const contentHash = createHash('sha256').update(bytes).digest('hex')
    const projection = projectedSource(bundle.run.id, sourceTask.id, contentHash)
    const reads: Array<readonly [string, string]> = []

    const artifacts = readUpstreamArtifacts({
      bundle,
      projection,
      nodeId: 'decide',
      readGitBlob: (commit, path) => {
        reads.push([commit, path])
        return bytes
      }
    })

    expect(artifacts).toEqual({ 'artifact.decision': { approved: true } })
    expect(reads).toEqual([['b'.repeat(40), 'decision.json']])
  })

  it('rejects a changed Git Artifact before it reaches the expression evaluator', () => {
    const bundle = createWorkflowRunBundle({
      runId: 'run.changed-artifact',
      definition: definition(),
      roleCatalog: [{ roleProfileId: 'role.builder', roleProfileVersion: 1, contentHash: hash }],
      createdAt: '2026-07-28T23:00:00Z'
    })
    const sourceTask = bundle.taskCatalog[0]!
    const projection = projectedSource(bundle.run.id, sourceTask.id, 'c'.repeat(64))
    expect(() =>
      readUpstreamArtifacts({
        bundle,
        projection,
        nodeId: 'decide',
        readGitBlob: () => '{"approved":true}\n'
      })
    ).toThrow('workflow_artifact_hash_mismatch')
  })
})

function definition() {
  return {
    schemaVersion: '1.0.0' as const,
    id: 'workflow.condition-artifacts',
    name: 'Condition Artifacts',
    version: 1,
    nodes: [
      {
        id: 'source',
        type: 'role_task' as const,
        recommendedRoleProfileIds: ['role.builder'],
        allowedRoleProfileIds: ['role.builder'],
        instruction: 'Write a decision.',
        workspaceMode: 'write' as const,
        inputs: [],
        outputs: [
          {
            schemaVersion: '1.0.0' as const,
            artifactType: 'artifact.decision',
            format: 'json-schema' as const,
            required: true,
            maxBytes: 1_000,
            jsonSchema: { type: 'object' }
          }
        ]
      },
      {
        id: 'decide',
        type: 'condition' as const,
        expression: 'approved',
        branches: { yes: 'finish' }
      },
      { id: 'finish', type: 'finish' as const, inputs: [] }
    ],
    edges: [
      { from: 'source', to: 'decide' },
      { from: 'decide', to: 'finish' }
    ],
    maxTransitions: 10,
    maxRunCostUsd: 1,
    maxRunDurationSeconds: 600
  }
}

function projectedSource(
  workflowRunId: string,
  taskId: string,
  contentHash: string
): WorkflowRunProjection {
  return {
    ...emptyWorkflowRunProjection(workflowRunId),
    tasks: {
      [taskId]: {
        status: 'submitted',
        roleProfileId: 'role.builder',
        roleProfileVersion: 1,
        assignedByUserId: 'user.owner',
        activeAttemptIds: [],
        knownAttemptIds: ['attempt.source'],
        reviewIds: [],
        executionWarnings: [],
        lastEventId: 'event.result'
      }
    },
    attempts: {
      'attempt.source': {
        taskId,
        status: 'submitted',
        lastEventId: 'event.result',
        result: {
          schemaVersion: '1.0.0',
          status: 'submitted',
          summary: 'Decision written.',
          verifications: [],
          risks: [],
          followUps: [],
          artifacts: [
            {
              contractId: 'artifact.decision',
              type: 'artifact.decision',
              contentRef: 'decision.json',
              sha256: contentHash
            }
          ],
          usage: { status: 'unknown' },
          system: {
            workflowRunId,
            nodeRunId: 'node-run.source',
            taskId,
            attemptId: 'attempt.source',
            roleInstanceId: 'role-instance.source',
            executorInvocationId: 'invocation.source',
            effectiveConfigHash: hash,
            submittedCommit: 'b'.repeat(40),
            createdAt: '2026-07-28T23:00:01Z'
          }
        }
      }
    }
  }
}
