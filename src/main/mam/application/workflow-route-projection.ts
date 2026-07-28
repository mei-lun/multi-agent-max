import type { WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'
import type { WorkflowRunProjection } from '../state-store/git-state-projection'

export type WorkflowRouteProjection = Readonly<{
  cancelledNodeIds: ReadonlySet<string>
}>

export function projectWorkflowRoute(
  bundle: WorkflowRunBundle,
  projection: WorkflowRunProjection
): WorkflowRouteProjection {
  const reachable = reachableNodeIds(bundle, projection)
  return {
    cancelledNodeIds: new Set(
      bundle.definition.nodes.filter((node) => !reachable.has(node.id)).map((node) => node.id)
    )
  }
}

function reachableNodeIds(
  bundle: WorkflowRunBundle,
  projection: WorkflowRunProjection
): ReadonlySet<string> {
  const outgoing = new Map<string, string[]>()
  const incoming = new Map(bundle.plan.nodes.map((node) => [node.id, 0]))
  for (const edge of bundle.plan.edges) {
    if (edge.maxTraversals !== undefined) continue
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to])
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1)
  }
  const nodes = new Map(bundle.definition.nodes.map((node) => [node.id, node]))
  const reachable = new Set<string>()
  const pending = [...incoming].filter(([, count]) => count === 0).map(([nodeId]) => nodeId)
  while (pending.length > 0) {
    const nodeId = pending.pop()!
    if (reachable.has(nodeId)) continue
    reachable.add(nodeId)
    const node = nodes.get(nodeId)!
    if (node.type === 'condition') {
      const selection = projection.resolvedConditions[node.id]?.selectedBranch
      if (selection) pending.push(node.branches[selection]!)
      else pending.push(...(outgoing.get(nodeId) ?? []))
      continue
    }
    pending.push(...(outgoing.get(nodeId) ?? []))
  }
  return reachable
}
