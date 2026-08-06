import type { z } from 'zod'

export function validateHumanReviewWorkflow(
  definition: {
    nodes: {
      id: string
      type: string
      revisionTargetNodeId?: string | undefined
      maxRevisionAttempts?: number | undefined
    }[]
    edges: {
      from: string
      to: string
      when?: string | undefined
      maxTraversals?: number | undefined
    }[]
  },
  context: z.RefinementCtx
): void {
  for (const node of definition.nodes) {
    if (node.type !== 'human_review_gate' || !node.revisionTargetNodeId) continue
    const target = definition.nodes.find((candidate) => candidate.id === node.revisionTargetNodeId)
    if (target?.type !== 'role_task') {
      context.addIssue({
        code: 'custom',
        path: ['nodes'],
        message: `human review ${node.id} must return to one role_task`
      })
    }
    const returnEdge = definition.edges.find(
      (edge) =>
        edge.from === node.id &&
        edge.to === node.revisionTargetNodeId &&
        edge.when === 'changes_requested'
    )
    if (!returnEdge?.maxTraversals || returnEdge.maxTraversals > (node.maxRevisionAttempts ?? 0)) {
      context.addIssue({
        code: 'custom',
        path: ['edges'],
        message: `human review ${node.id} needs a bounded changes_requested return edge`
      })
    }
  }
}
