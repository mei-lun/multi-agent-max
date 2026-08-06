export function containsWorkflowCycle(
  nodeIds: ReadonlySet<string>,
  edges: readonly Readonly<{ from: string; to: string }>[]
): boolean {
  const adjacency = new Map([...nodeIds].map((id) => [id, [] as string[]]))
  const indegree = new Map([...nodeIds].map((id) => [id, 0]))
  for (const edge of edges) {
    adjacency.get(edge.from)?.push(edge.to)
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1)
  }
  const ready = [...indegree].filter(([, count]) => count === 0).map(([id]) => id)
  let visited = 0
  for (let cursor = 0; cursor < ready.length; cursor += 1) {
    const id = ready[cursor]
    if (!id) continue
    visited += 1
    for (const next of adjacency.get(id) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1
      indegree.set(next, remaining)
      if (remaining === 0) ready.push(next)
    }
  }
  return visited !== nodeIds.size
}
