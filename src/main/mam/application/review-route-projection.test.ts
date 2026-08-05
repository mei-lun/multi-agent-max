import { describe, expect, it } from 'vitest'
import type { WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'
import { reachableReviewNodeIds } from './review-route-projection'

describe('Review route projection', () => {
  it('does not route an earlier Task across a later executable Task', () => {
    const bundle = reviewBundle([
      { from: 'design', to: 'build' },
      { from: 'build', to: 'review' }
    ])

    expect(reachableReviewNodeIds(bundle, 'design')).toEqual([])
    expect(reachableReviewNodeIds(bundle, 'build')).toEqual(['review'])
  })

  it('allows routing through non-executable coordination nodes', () => {
    const bundle = reviewBundle([
      { from: 'build', to: 'join' },
      { from: 'join', to: 'review' }
    ])

    expect(reachableReviewNodeIds(bundle, 'build')).toEqual(['review'])
  })
})

function reviewBundle(edges: readonly { from: string; to: string }[]): WorkflowRunBundle {
  return {
    definition: {
      nodes: [
        { id: 'design', type: 'role_task' },
        { id: 'build', type: 'role_task' },
        { id: 'join', type: 'join' },
        { id: 'review', type: 'review_gate' }
      ],
      edges
    },
    taskCatalog: [{ nodeId: 'design' }, { nodeId: 'build' }]
  } as unknown as WorkflowRunBundle
}
