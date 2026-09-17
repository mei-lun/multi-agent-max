import { describe, expect, it } from 'vitest'
import { validateReviewAggregateWorkflow } from './review-aggregate-workflow-validation'

describe('validateReviewAggregateWorkflow', () => {
  it('rejects cross-target revision and members outside the producer lineage', () => {
    const issues: unknown[] = []
    validateReviewAggregateWorkflow(
      {
        nodes: [
          { id: 'producer', type: 'role_task' },
          { id: 'other', type: 'role_task' },
          { id: 'review.a', type: 'review_gate' },
          { id: 'review.b', type: 'review_gate' },
          {
            id: 'aggregate', type: 'review_aggregate', producerNodeId: 'producer',
            revisionTargetNodeId: 'other', reviewNodeIds: ['review.a', 'review.b'], totalQuorum: 2
          }
        ],
        edges: [
          { from: 'producer', to: 'review.a' },
          { from: 'review.a', to: 'aggregate' },
          { from: 'review.b', to: 'aggregate' }
        ]
      },
      { addIssue: (issue: unknown) => issues.push(issue) } as never
    )
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('must revise its producer') }),
        expect.objectContaining({ message: expect.stringContaining('does not review its producer') })
      ])
    )
  })

  it('does not cross another executable Task to borrow its Review Gate', () => {
    const issues: Array<{ message?: string }> = []
    validateReviewAggregateWorkflow(
      {
        nodes: [
          { id: 'producer', type: 'role_task' },
          { id: 'other-task', type: 'role_task' },
          { id: 'review.a', type: 'review_gate' },
          { id: 'review.b', type: 'review_gate' },
          {
            id: 'aggregate', type: 'review_aggregate', producerNodeId: 'producer',
            revisionTargetNodeId: 'producer', reviewNodeIds: ['review.a', 'review.b'], totalQuorum: 2
          }
        ],
        edges: [
          { from: 'producer', to: 'review.a' },
          { from: 'producer', to: 'other-task' },
          { from: 'other-task', to: 'review.b' },
          { from: 'review.a', to: 'aggregate' },
          { from: 'review.b', to: 'aggregate' }
        ]
      },
      { addIssue: (issue: { message?: string }) => issues.push(issue) } as never
    )
    expect(issues.some((issue) => issue.message?.includes('review.b does not review'))).toBe(true)
  })
})
