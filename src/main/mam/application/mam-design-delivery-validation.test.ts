import { describe, expect, it } from 'vitest'
import type { WorkflowDefinition } from '../../../shared/mam/domain/workflow'
import { validateMamDesignDelivery } from './mam-design-delivery-validation'

describe('MAM Design delivery validation', () => {
  it('rejects a write task that finishes on its isolated task branch', () => {
    const workflow = {
      nodes: [
        { id: 'implement', type: 'role_task', workspaceMode: 'write' },
        { id: 'finish', type: 'finish' }
      ],
      edges: [{ from: 'implement', to: 'finish' }]
    } as WorkflowDefinition

    expect(validateMamDesignDelivery(workflow)).toEqual([
      expect.objectContaining({ code: 'write_delivery_route_required', severity: 'error' })
    ])
  })

  it('accepts Review, develop integration, user approval, and main promotion', () => {
    const workflow = {
      nodes: [
        { id: 'implement', type: 'role_task', workspaceMode: 'write' },
        { id: 'review', type: 'review_gate' },
        { id: 'develop', type: 'git_merge', targetBranch: 'develop' },
        { id: 'approve', type: 'approval_gate' },
        { id: 'main', type: 'git_merge', targetBranch: 'main' },
        { id: 'finish', type: 'finish' }
      ],
      edges: [
        { from: 'implement', to: 'review' },
        { from: 'review', to: 'develop' },
        { from: 'develop', to: 'approve' },
        { from: 'approve', to: 'main' },
        { from: 'main', to: 'finish' }
      ]
    } as WorkflowDefinition

    expect(validateMamDesignDelivery(workflow)).toEqual([])
  })
})
