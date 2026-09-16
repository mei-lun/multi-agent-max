import { describe, expect, it } from 'vitest'
import type { WorkflowDefinition } from '../../../shared/mam/domain/workflow'
import { validateMamDesignHandoffs } from './mam-design-handoff-validation'

describe('MAM Design handoff validation', () => {
  it('rejects an isolated Role-to-Role Artifact handoff', () => {
    const workflow = workflowWithHandoff([
      { from: 'design', to: 'implement' },
      { from: 'implement', to: 'finish' }
    ])

    expect(validateMamDesignHandoffs(workflow)).toContainEqual(
      expect.objectContaining({ code: 'role_handoff_integration_required', severity: 'error' })
    )
  })

  it('accepts a reviewed integration boundary before the consuming Role', () => {
    const workflow = workflowWithHandoff([
      { from: 'design', to: 'review-design' },
      { from: 'review-design', to: 'integrate-design' },
      { from: 'integrate-design', to: 'implement' },
      { from: 'implement', to: 'finish' }
    ])

    expect(validateMamDesignHandoffs(workflow)).toEqual([])
  })

  it('rejects a Review that belongs to an intervening Role task', () => {
    const workflow = workflowWithHandoff([
      { from: 'design', to: 'intermediate' },
      { from: 'intermediate', to: 'review-design' },
      { from: 'review-design', to: 'integrate-design' },
      { from: 'integrate-design', to: 'implement' },
      { from: 'implement', to: 'finish' }
    ])

    expect(validateMamDesignHandoffs(workflow)).toContainEqual(
      expect.objectContaining({ code: 'role_handoff_integration_required' })
    )
  })
})

function workflowWithHandoff(edges: WorkflowDefinition['edges']): WorkflowDefinition {
  const artifact = {
    artifactId: 'artifact.design',
    version: 1,
    contentHash: '0'.repeat(64)
  }
  return {
    nodes: [
      {
        id: 'design',
        type: 'role_task',
        workspaceMode: 'write',
        inputs: [],
        outputs: [{ artifactType: 'artifact.design' }]
      },
      { id: 'review-design', type: 'review_gate' },
      { id: 'integrate-design', type: 'git_merge' },
      { id: 'intermediate', type: 'role_task', inputs: [], outputs: [] },
      { id: 'implement', type: 'role_task', inputs: [artifact], outputs: [] },
      { id: 'finish', type: 'finish' }
    ],
    edges
  } as unknown as WorkflowDefinition
}
