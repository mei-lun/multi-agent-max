import type { z } from 'zod'
import { validateHumanReviewWorkflow } from './human-review-workflow-validation'
import { validateReviewAggregateWorkflow } from './review-aggregate-workflow-validation'
import { containsWorkflowCycle } from './workflow-cycle-detection'

export function validateWorkflowDefinition(
  definition: {
    nodes: {
      id: string
      type: string
      recommendedRoleProfileIds?: string[]
      allowedRoleProfileIds?: string[]
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
  validateRoleBindings(definition, context)
  const nodeIds = validateNodeIds(definition, context)
  validateHumanReviewWorkflow(definition, context)
  validateReviewAggregateWorkflow(definition, context)
  validateEdges(definition, nodeIds, context)
}

function validateRoleBindings(
  definition: Parameters<typeof validateWorkflowDefinition>[0],
  context: z.RefinementCtx
): void {
  for (const node of definition.nodes) {
    if (
      node.allowedRoleProfileIds &&
      node.recommendedRoleProfileIds &&
      node.allowedRoleProfileIds[0] !== node.recommendedRoleProfileIds[0]
    ) {
      context.addIssue({
        code: 'custom',
        path: ['nodes'],
        message: `node ${node.id} must bind one fixed Role`
      })
    }
  }
}

function validateNodeIds(
  definition: Parameters<typeof validateWorkflowDefinition>[0],
  context: z.RefinementCtx
): ReadonlySet<string> {
  const nodeIds = new Set<string>()
  for (const node of definition.nodes) {
    if (nodeIds.has(node.id)) {
      context.addIssue({
        code: 'custom',
        path: ['nodes'],
        message: `duplicate node id: ${node.id}`
      })
    }
    nodeIds.add(node.id)
  }
  if (!definition.nodes.some((node) => node.type === 'finish')) {
    context.addIssue({ code: 'custom', path: ['nodes'], message: 'workflow requires a finish node' })
  }
  return nodeIds
}

function validateEdges(
  definition: Parameters<typeof validateWorkflowDefinition>[0],
  nodeIds: ReadonlySet<string>,
  context: z.RefinementCtx
): void {
  const unboundedEdges = definition.edges.filter((edge) => {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      context.addIssue({
        code: 'custom',
        path: ['edges'],
        message: `edge references unknown node: ${edge.from} -> ${edge.to}`
      })
      return false
    }
    return edge.maxTraversals === undefined
  })
  if (containsWorkflowCycle(nodeIds, unboundedEdges)) {
    context.addIssue({
      code: 'custom',
      path: ['edges'],
      message: 'workflow contains an unbounded cycle; every cycle requires maxTraversals'
    })
  }
}
