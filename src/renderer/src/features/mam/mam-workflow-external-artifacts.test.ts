import { describe, expect, it } from 'vitest'
import type { WorkflowDefinition } from '../../../../shared/mam/domain/workflow'
import { workflowExternalArtifactRefs } from './mam-workflow-external-artifacts'

const hash = 'a'.repeat(64)

describe('Workflow external Artifacts', () => {
  it('does not ask for Artifacts produced by upstream Tasks', () => {
    const workflow = definition([
      task('design', [], ['artifact.design-spec']),
      task('implement', [artifact('artifact.design-spec')], ['artifact.web-files']),
      { id: 'finish', type: 'finish', inputs: [artifact('artifact.web-files')] }
    ])
    workflow.edges = [
      { from: 'design', to: 'implement' },
      { from: 'implement', to: 'finish' }
    ]

    expect(workflowExternalArtifactRefs(workflow)).toEqual([])
  })

  it('returns configured immutable references that have no upstream producer', () => {
    const external = artifact('artifact.requirements')
    const workflow = definition([
      task('implement', [external], ['artifact.web-files']),
      { id: 'finish', type: 'finish', inputs: [artifact('artifact.web-files')] }
    ])
    workflow.edges = [{ from: 'implement', to: 'finish' }]

    expect(workflowExternalArtifactRefs(workflow)).toEqual([external])
  })
})

function definition(nodes: WorkflowDefinition['nodes']): WorkflowDefinition {
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.test',
    name: 'Test',
    version: 1,
    nodes,
    edges: [],
    maxTransitions: 10,
    maxRunCostUsd: 1,
    maxRunDurationSeconds: 600
  }
}

function task(
  id: string,
  inputs: ReturnType<typeof artifact>[],
  outputTypes: string[]
): WorkflowDefinition['nodes'][number] {
  return {
    id,
    type: 'role_task',
    recommendedRoleProfileIds: [],
    allowedRoleProfileIds: ['role.builder'],
    instruction: id,
    workspaceMode: 'write',
    inputs,
    outputs: outputTypes.map((artifactType) => ({
      schemaVersion: '1.0.0',
      artifactType,
      format: 'file-set',
      required: true,
      maxBytes: 1024,
      allowedGlobs: ['**/*']
    }))
  }
}

function artifact(artifactId: string) {
  return { artifactId, version: 1, contentHash: hash }
}
