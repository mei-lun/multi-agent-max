import { describe, expect, it } from 'vitest'
import type { WorkflowDefinition } from '../../../../shared/mam/domain/workflow'
import { workflowArtifactRelations } from './mam-workflow-artifact-relations'

const hash = 'a'.repeat(64)
const artifact = { artifactId: 'artifact.output', version: 1, contentHash: hash }
const contract = {
  schemaVersion: '1.0.0' as const,
  artifactType: 'artifact.output',
  format: 'json-schema' as const,
  required: true,
  maxBytes: 1000,
  jsonSchema: { type: 'object' }
}

function workflow(secondProducer = false): WorkflowDefinition {
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.artifact',
    name: 'Artifact',
    version: 1,
    nodes: [
      {
        id: 'producer',
        type: 'role_task',
        recommendedRoleProfileIds: ['role.a'],
        allowedRoleProfileIds: ['role.a'],
        instruction: 'Produce.',
        workspaceMode: 'write',
        inputs: [],
        outputs: [contract]
      },
      ...(secondProducer
        ? [
            {
              id: 'other',
              type: 'role_task' as const,
              recommendedRoleProfileIds: ['role.a'],
              allowedRoleProfileIds: ['role.a'],
              instruction: 'Produce again.',
              workspaceMode: 'write' as const,
              inputs: [],
              outputs: [contract]
            }
          ]
        : []),
      { id: 'consumer', type: 'finish', inputs: [artifact] }
    ],
    edges: [
      { from: 'producer', to: 'consumer' },
      ...(secondProducer
        ? [
            { from: 'producer', to: 'other' },
            { from: 'other', to: 'consumer' }
          ]
        : [])
    ],
    maxTransitions: 10,
    maxRunCostUsd: 1,
    maxRunDurationSeconds: 60
  }
}

describe('workflow Artifact relationships', () => {
  it('renders one candidate source as possible, not observed', () => {
    expect(workflowArtifactRelations(workflow())).toMatchObject([
      {
        status: 'possible',
        sourceId: 'producer',
        targetId: 'consumer',
        artifactId: 'artifact.output'
      }
    ])
  })

  it('does not pick one source when several ancestors produce the same type', () => {
    expect(workflowArtifactRelations(workflow(true))).toMatchObject([
      { status: 'ambiguous', candidateIds: ['other', 'producer'] }
    ])
    expect(workflowArtifactRelations(workflow(true))[0]?.sourceId).toBeUndefined()
  })

  it('distinguishes a matching initial Artifact from a node output', () => {
    const definition = workflow()
    definition.nodes.splice(0, 1)
    definition.edges = []
    expect(workflowArtifactRelations(definition, [artifact])[0]?.status).toBe('initial')
  })
})
