import type { WorkflowDefinition, WorkflowEdge } from '../../../../shared/mam/domain/workflow'

export type WorkflowVisualAnalysis = Readonly<{
  ranks: ReadonlyMap<string, number>
  baseOutgoing: ReadonlyMap<string, readonly string[]>
  returnEdges: readonly WorkflowEdge[]
  cyclicNodeIds: ReadonlySet<string>
  parallelGroups: readonly Readonly<{
    splitId: string
    joinId: string
    branchIds: readonly string[]
  }>[]
  diagnostics: readonly string[]
}>

export function analyzeWorkflowVisual(definition: WorkflowDefinition): WorkflowVisualAnalysis {
  const ids = new Set(definition.nodes.map((node) => node.id))
  const incoming = new Map([...ids].map((id) => [id, 0]))
  const outgoing = new Map([...ids].map((id) => [id, [] as string[]]))
  const returnEdges: WorkflowEdge[] = []
  const diagnostics: string[] = []
  for (const edge of definition.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue
    if (edge.maxTraversals !== undefined) {
      returnEdges.push(edge)
      continue
    }
    if (!outgoing.get(edge.from)!.includes(edge.to)) {
      outgoing.get(edge.from)!.push(edge.to)
      incoming.set(edge.to, incoming.get(edge.to)! + 1)
    }
  }
  for (const targets of outgoing.values()) targets.sort()
  const ready = [...ids].filter((id) => incoming.get(id) === 0).sort()
  const ranks = new Map([...ids].map((id) => [id, 0]))
  let visited = 0
  while (ready.length > 0) {
    const id = ready.shift()!
    visited += 1
    for (const next of outgoing.get(id) ?? []) {
      ranks.set(next, Math.max(ranks.get(next) ?? 0, (ranks.get(id) ?? 0) + 1))
      incoming.set(next, incoming.get(next)! - 1)
      if (incoming.get(next) === 0) {
        ready.push(next)
        ready.sort()
      }
    }
  }
  if (visited !== ids.size) diagnostics.push('基础路径包含未受限的循环，无法确定完整阅读顺序。')
  const pins = Object.entries(definition.presentation?.pinnedPositions ?? {})
  for (let at = 0; at < pins.length; at += 1) {
    const [id, point] = pins[at]!
    for (const [otherId, other] of pins.slice(at + 1)) {
      if (Math.abs(point.x - other.x) < 214 && Math.abs(point.y - other.y) < 140) {
        diagnostics.push(`固定节点 ${id} 与 ${otherId} 发生重叠；可使用自动整理。`)
      }
    }
  }
  const cyclicNodeIds = cyclicNodes(ids, definition.edges)
  const parallelGroups = definition.nodes.flatMap((node) => {
    if (node.type !== 'parallel') return []
    const candidates = definition.nodes.filter(
      (candidate) =>
        candidate.type === 'join' &&
        node.branches.every(
          (branch) => branch === candidate.id || reaches(branch, candidate.id, outgoing)
        ) &&
        candidate.waitFor.every((source) =>
          node.branches.some((branch) => source === branch || reaches(branch, source, outgoing))
        )
    )
    if (candidates.length !== 1) {
      diagnostics.push(`并行节点 ${node.id} 无法确定唯一的汇合区域。`)
      return []
    }
    return [{ splitId: node.id, joinId: candidates[0]!.id, branchIds: [...node.branches] }]
  })
  return { ranks, baseOutgoing: outgoing, returnEdges, cyclicNodeIds, parallelGroups, diagnostics }
}

function reaches(
  start: string,
  end: string,
  outgoing: ReadonlyMap<string, readonly string[]>
): boolean {
  const pending = [start]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const id = pending.pop()!
    if (id === end) return true
    if (visited.has(id)) continue
    visited.add(id)
    pending.push(...(outgoing.get(id) ?? []))
  }
  return false
}

function cyclicNodes(
  ids: ReadonlySet<string>,
  edges: readonly WorkflowEdge[]
): ReadonlySet<string> {
  const adjacency = new Map([...ids].map((id) => [id, [] as string[]]))
  for (const edge of edges) adjacency.get(edge.from)?.push(edge.to)
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const active = new Set<string>()
  const cyclic = new Set<string>()
  const visit = (id: string): void => {
    index.set(id, index.size)
    low.set(id, index.get(id)!)
    stack.push(id)
    active.add(id)
    for (const next of adjacency.get(id) ?? []) {
      if (!index.has(next)) {
        visit(next)
        low.set(id, Math.min(low.get(id)!, low.get(next)!))
      } else if (active.has(next)) {
        low.set(id, Math.min(low.get(id)!, index.get(next)!))
      }
    }
    if (low.get(id) !== index.get(id)) return
    const component: string[] = []
    let member: string
    do {
      member = stack.pop()!
      active.delete(member)
      component.push(member)
    } while (member !== id)
    if (component.length > 1 || (adjacency.get(id) ?? []).includes(id)) {
      component.forEach((nodeId) => cyclic.add(nodeId))
    }
  }
  for (const id of [...ids].sort()) if (!index.has(id)) visit(id)
  return cyclic
}
