import type { WorkflowDefinition } from '../../../../shared/mam/domain/workflow'
import type { WorkflowPoint } from './mam-workflow-layout'

type ReturnRoute = Readonly<{ from: string; to: string; when?: string; maxTraversals: number }>
export type ReturnChannel = Readonly<{
  y: number
  sourceCorridorX: number
  targetCorridorX: number
}>

export function returnEdgeChannels(
  definition: WorkflowDefinition,
  positions: ReadonlyMap<string, WorkflowPoint>
): ReadonlyMap<number, ReturnChannel> {
  const routes = definition.edges
    .map((edge, index) => ({ edge, index }))
    .filter(
      (entry): entry is { edge: ReturnRoute; index: number } =>
        entry.edge.maxTraversals !== undefined
    )
    .sort((a, b) => {
      const left = `${a.edge.from}:${a.edge.to}:${a.edge.when ?? ''}:${a.edge.maxTraversals}`
      const right = `${b.edge.from}:${b.edge.to}:${b.edge.when ?? ''}:${b.edge.maxTraversals}`
      return left.localeCompare(right) || a.index - b.index
    })
  const result = new Map<number, ReturnChannel>()
  const reserved: Array<{ left: number; right: number; y: number }> = []
  for (const { edge, index } of routes) {
    const source = positions.get(edge.from)
    const target = positions.get(edge.to)
    if (!source || !target) continue
    const left = Math.min(source.x + 57, target.x + 133) - 10
    const right = Math.max(source.x + 57, target.x + 133) + 10
    const obstacles = [...positions].filter(([, point]) => point.x < right && point.x + 190 > left)
    const top = Math.min(source.y, target.y, ...obstacles.map(([, point]) => point.y))
    let y = top - 70
    while (
      reserved.some(
        (route) => route.left < right && route.right > left && Math.abs(route.y - y) < 38
      )
    ) {
      y -= 42
    }
    reserved.push({ left, right, y })
    result.set(index, { y, sourceCorridorX: source.x - 28, targetCorridorX: target.x + 218 })
  }
  return result
}
