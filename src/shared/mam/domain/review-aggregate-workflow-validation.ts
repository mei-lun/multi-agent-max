import type { z } from 'zod'

type ValidationNode = Readonly<{
  id: string
  type: string
  reviewNodeIds?: readonly string[]
  producerNodeId?: string
  revisionTargetNodeId?: string | undefined
  totalQuorum?: number
}>

type ValidationDefinition = Readonly<{
  nodes: readonly ValidationNode[]
  edges: readonly Readonly<{ from: string; to: string }>[]
}>

export function validateReviewAggregateWorkflow(
  definition: ValidationDefinition,
  context: z.RefinementCtx
): void {
  const { nodes } = definition
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const executableNodeIds = new Set(
    nodes
      .filter((node) => node.type === 'role_task' || node.type === 'dynamic_tasks')
      .map((node) => node.id)
  )
  for (const node of nodes.filter((candidate) => candidate.type === 'review_aggregate')) {
    const members = node.reviewNodeIds ?? []
    if (new Set(members).size !== members.length) issue(context, node.id, 'repeats a Review Gate')
    if ((node.totalQuorum ?? 0) > members.length)
      issue(context, node.id, 'quorum exceeds its members')
    for (const memberId of members) {
      if (nodesById.get(memberId)?.type !== 'review_gate')
        issue(context, node.id, `member ${memberId} is not a Review Gate`)
    }
    if (
      !nodesById.has(node.producerNodeId ?? '') ||
      !nodesById.has(node.revisionTargetNodeId ?? '')
    ) {
      issue(context, node.id, 'references an unknown producer or revision target')
    }
    if (node.revisionTargetNodeId !== node.producerNodeId) {
      issue(context, node.id, 'must revise its producer node')
    }
    for (const memberId of members) {
      if (!reachable(definition.edges, node.producerNodeId ?? '', memberId, executableNodeIds))
        issue(context, node.id, `member ${memberId} does not review its producer`)
      if (!reachable(definition.edges, memberId, node.id))
        issue(context, node.id, `member ${memberId} does not feed the aggregate`)
    }
  }
}

function reachable(
  edges: readonly Readonly<{ from: string; to: string }>[],
  source: string,
  target: string,
  blockingNodeIds: ReadonlySet<string> = new Set()
): boolean {
  const pending = [source]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const current = pending.pop()!
    if (visited.has(current)) continue
    visited.add(current)
    if (blockingNodeIds.has(current) && current !== source) continue
    if (current === target) return true
    pending.push(...edges.filter((edge) => edge.from === current).map((edge) => edge.to))
  }
  return false
}

function issue(context: z.RefinementCtx, nodeId: string, detail: string): void {
  context.addIssue({
    code: 'custom',
    path: ['nodes'],
    message: `review aggregate ${nodeId} ${detail}`
  })
}
