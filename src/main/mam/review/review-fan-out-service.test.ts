import { describe, expect, it } from 'vitest'
import type { WorkflowDefinition } from '../../../shared/mam/domain/workflow'
import { createWorkflowRunBundle } from '../application/workflow-run-factory'
import { createReviewTasks } from './review-fan-out-service'

const hash = 'a'.repeat(64)
const subject = {
  taskId: 'task.implementation',
  attemptId: 'attempt.implementation.2',
  resultHash: 'b'.repeat(64),
  artifactHashes: ['c'.repeat(64)],
  submittedCommit: 'abcdef1'
}

describe('Review fan-out service', () => {
  it('creates deterministic review slots for the fixed Workflow Role', () => {
    const bundle = reviewBundle(2)
    const first = createReviewTasks({ bundle, reviewNodeId: 'review', subject })
    const second = createReviewTasks({ bundle, reviewNodeId: 'review', subject })

    expect(second).toEqual(first)
    expect(first).toHaveLength(2)
    expect(first.map((task) => task.allowedRoleProfileIds)).toEqual([
      ['role.reviewer-a'],
      ['role.reviewer-a']
    ])
    expect(first.map((task) => task.recommendedRoleProfileIds)).toEqual([
      ['role.reviewer-a'],
      ['role.reviewer-a']
    ])
    expect(first.every((task) => task.initialStatus === 'waiting_role_assignment')).toBe(true)
    expect(first.every((task) => !('assignment' in task))).toBe(true)
    expect(first.map((task) => task.subject)).toEqual([subject, subject])
  })

  it('rejects a fixed Review Role outside the Run catalog', () => {
    const duplicate = reviewBundle(2)
    const duplicateNode = duplicate.definition.nodes.find((node) => node.id === 'review')!
    if (duplicateNode.type !== 'review_gate') throw new Error('expected review_gate')
    expect(() =>
      createReviewTasks({
        bundle: {
          ...duplicate,
          definition: {
            ...duplicate.definition,
            nodes: [
              ...duplicate.definition.nodes.filter((node) => node.id !== 'review'),
              {
                ...duplicateNode,
                recommendedRoleProfileIds: ['role.foreign'],
                allowedRoleProfileIds: ['role.foreign']
              }
            ]
          }
        },
        reviewNodeId: 'review',
        subject
      })
    ).toThrow(expect.objectContaining({ code: 'review_role_not_in_run_catalog' }))
  })
})

function reviewBundle(minimumDecisions: number) {
  return createWorkflowRunBundle({
    runId: `run.review-fan-out.${minimumDecisions}`,
    definition: reviewWorkflow(minimumDecisions),
    roleCatalog: [
      { roleProfileId: 'role.developer', roleProfileVersion: 1, contentHash: hash },
      { roleProfileId: 'role.reviewer-a', roleProfileVersion: 1, contentHash: hash },
      { roleProfileId: 'role.reviewer-b', roleProfileVersion: 1, contentHash: hash },
      { roleProfileId: 'role.reviewer-c', roleProfileVersion: 1, contentHash: hash }
    ],
    createdAt: '2026-07-28T16:00:00Z'
  })
}

function reviewWorkflow(minimumDecisions: number): WorkflowDefinition {
  const reviewedArtifact = {
    artifactId: 'artifact.implementation',
    version: 1,
    contentHash: hash
  }
  return {
    schemaVersion: '1.0.0',
    id: `workflow.review-fan-out.${minimumDecisions}`,
    name: 'Review fan-out',
    version: 1,
    nodes: [
      {
        id: 'implementation',
        type: 'role_task',
        recommendedRoleProfileIds: ['role.developer'],
        allowedRoleProfileIds: ['role.developer'],
        instruction: 'Implement the feature.',
        workspaceMode: 'write',
        inputs: [],
        outputs: [diffContract('artifact.implementation')]
      },
      {
        id: 'review',
        type: 'review_gate',
        recommendedRoleProfileIds: ['role.reviewer-a'],
        allowedRoleProfileIds: ['role.reviewer-a'],
        inputs: [reviewedArtifact],
        reportContract: {
          schemaVersion: '1.0.0',
          artifactType: 'artifact.review-report',
          format: 'json-schema',
          required: true,
          maxBytes: 100_000,
          jsonSchema: { type: 'object' }
        },
        minimumDecisions,
        maxRevisionAttempts: 3
      },
      { id: 'finish', type: 'finish', inputs: [reviewedArtifact] }
    ],
    edges: [
      { from: 'implementation', to: 'review' },
      { from: 'review', to: 'finish' }
    ],
    maxTransitions: 20,
    maxRunCostUsd: 20,
    maxRunDurationSeconds: 3600
  }
}

function diffContract(artifactType: string) {
  return {
    schemaVersion: '1.0.0' as const,
    artifactType,
    format: 'diff' as const,
    required: true,
    maxBytes: 1_000_000
  }
}
