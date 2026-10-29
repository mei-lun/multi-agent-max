import type { WorkflowEdge } from '../../../../shared/mam/domain/workflow'

export function reachableWorkflowNodes(
  start: string,
  edges: readonly Pick<WorkflowEdge, 'from' | 'to'>[],
  direction: 'upstream' | 'downstream'
): ReadonlySet<string> {
  const adjacent = new Map<string, string[]>()
  for (const edge of edges) {
    const from = direction === 'downstream' ? edge.from : edge.to
    const to = direction === 'downstream' ? edge.to : edge.from
    const targets = adjacent.get(from) ?? []
    targets.push(to)
    adjacent.set(from, targets)
  }
  const visited = new Set<string>()
  const pending = [start]
  while (pending.length > 0) {
    const id = pending.pop()!
    if (visited.has(id)) continue
    visited.add(id)
    pending.push(...(adjacent.get(id) ?? []))
  }
  return visited
}
