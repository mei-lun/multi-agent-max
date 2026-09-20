export function reviewGateWorkflowIssues(definition: {
  nodes: { id: string; type: string; maxRevisionAttempts?: number | undefined }[]
  edges: {
    from: string
    to: string
    when?: string | undefined
    maxTraversals?: number | undefined
  }[]
}): readonly string[] {
  const issues: string[] = []
  for (const node of definition.nodes) {
    if (node.type !== 'review_gate') continue
    if ((node.maxRevisionAttempts ?? 1) <= 1) continue
    const incoming = new Map<string, string[]>()
    for (const edge of definition.edges) {
      if (edge.maxTraversals === undefined) {
        incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from])
      }
    }
    const upstreamRoleIds = upstreamRoleTaskIds(node.id, incoming, definition.nodes)
    if (upstreamRoleIds.length === 0) continue
    const returnEdge = definition.edges.find(
      (edge) =>
        edge.from === node.id &&
        edge.when === 'changes_requested' &&
        upstreamRoleIds.includes(edge.to)
    )
    if (!returnEdge?.maxTraversals || returnEdge.maxTraversals > (node.maxRevisionAttempts ?? 0)) {
      issues.push(
        `review ${node.id} needs a bounded changes_requested return edge to its upstream role_task`
      )
    }
  }
  return issues
}

function upstreamRoleTaskIds(
  reviewNodeId: string,
  incoming: ReadonlyMap<string, readonly string[]>,
  nodes: readonly { id: string; type: string }[]
): readonly string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const found = new Set<string>()
  const visited = new Set<string>()
  const pending = [...(incoming.get(reviewNodeId) ?? [])]
  while (pending.length > 0) {
    const id = pending.pop()!
    if (visited.has(id)) continue
    visited.add(id)
    if (byId.get(id)?.type === 'role_task') {
      found.add(id)
      continue
    }
    pending.push(...(incoming.get(id) ?? []))
  }
  return [...found]
}
