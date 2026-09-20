import { describe, expect, it } from 'vitest'
import { parseMamDesignModelResponse } from './mam-design-response-normalizer'

describe('MAM Design response normalizer', () => {
  it('normalizes misplaced and missing Review bounds locally', () => {
    const response = parseMamDesignModelResponse(
      JSON.stringify({
        message: 'Draft ready.',
        roles: [],
        workflow: {
          key: 'review-workflow',
          name: 'Review workflow',
          nodes: [
            {
              key: 'approve',
              type: 'approval_gate',
              prompt: 'Continue?',
              options: ['Continue'],
              recommendedRoleKeys: ['reviewer'],
              allowedRoleKeys: ['reviewer'],
              minimumDecisions: 1,
              maxRevisionAttempts: 2
            },
            {
              key: 'review',
              type: 'review_gate',
              recommendedRoleKeys: ['reviewer'],
              allowedRoleKeys: ['reviewer'],
              inputArtifactKeys: ['draft'],
              reportContract: { key: 'review-report' }
            },
            { key: 'finish', type: 'finish', inputArtifactKeys: ['draft'] }
          ],
          edges: [
            { from: 'approve', to: 'review' },
            { from: 'review', to: 'finish' }
          ],
          'integrate-design-develop-placeholder': true
        }
      })
    )

    expect(response.proposal.workflow.nodes).toEqual([
      {
        key: 'approve',
        type: 'approval_gate',
        prompt: 'Continue?',
        options: ['Continue']
      },
      expect.objectContaining({
        key: 'review',
        type: 'review_gate',
        minimumDecisions: 1,
        maxRevisionAttempts: 2
      }),
      { key: 'finish', type: 'finish', inputArtifactKeys: ['draft'] }
    ])
  })
})
