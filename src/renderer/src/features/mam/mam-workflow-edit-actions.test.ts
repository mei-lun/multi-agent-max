import { describe, expect, it } from 'vitest'
import type { WorkflowDefinition } from '../../../../shared/mam/domain/workflow'
import {
  connectWorkflowNodes,
  deleteWorkflowEdges,
  deleteWorkflowNodes,
  replaceWorkflowEdge,
  renameWorkflowNode
} from './mam-workflow-edit-actions'

function definition(): WorkflowDefinition {
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.edit',
    name: 'Edit',
    version: 1,
    nodes: [
      {
        id: 'build',
        type: 'role_task',
        recommendedRoleProfileIds: ['role.a'],
        allowedRoleProfileIds: ['role.a'],
        instruction: 'Build',
        workspaceMode: 'write',
        inputs: [],
        outputs: [
          {
            schemaVersion: '1.0.0',
            artifactType: 'artifact.output',
            format: 'diff',
            required: true,
            maxBytes: 100
          }
        ]
      },
      {
        id: 'human',
        type: 'human_review_gate',
        inputs: [{ artifactId: 'artifact.output', version: 1, contentHash: 'a'.repeat(64) }],
        instructions: 'Review',
        revisionTargetNodeId: 'build',
        maxRevisionAttempts: 2
      },
      { id: 'finish', type: 'finish', inputs: [] }
    ],
    edges: [{ from: 'build', to: 'finish' }],
    presentation: {
      schemaVersion: 1,
      pinnedPositions: { build: { x: 0, y: 0 }, human: { x: 260, y: 0 } }
    },
    maxTransitions: 10,
    maxRunCostUsd: 1,
    maxRunDurationSeconds: 60
  }
}

describe('workflow edit actions', () => {
  it('adds a human review return edge atomically with its upstream binding', () => {
    const next = connectWorkflowNodes(definition(), 'build', 'human')
    expect(next.edges).toContainEqual({
      from: 'human',
      to: 'build',
      when: 'changes_requested',
      maxTraversals: 2
    })
    expect(next.nodes.find((node) => node.id === 'human')).toMatchObject({
      revisionTargetNodeId: 'build'
    })
    expect(() => connectWorkflowNodes(next, 'build', 'human')).toThrow('already exists')
  })

  it('updates and removes graph references without leaving pinned or stale edges', () => {
    const renamed = renameWorkflowNode(definition(), 'build', 'implementation')
    expect(renamed.presentation?.pinnedPositions).toHaveProperty('implementation')
    expect(
      deleteWorkflowNodes(renamed, new Set(['human'])).presentation?.pinnedPositions
    ).not.toHaveProperty('human')
    expect(deleteWorkflowNodes(renamed, new Set(['finish'])).edges).toEqual([])
  })

  it('edits and removes a single indexed control edge', () => {
    const next = replaceWorkflowEdge(definition(), 0, {
      from: 'build',
      to: 'finish',
      when: 'approved'
    })
    expect(next.edges[0]?.when).toBe('approved')
    expect(deleteWorkflowEdges(next, new Set([0])).edges).toEqual([])
  })
})
