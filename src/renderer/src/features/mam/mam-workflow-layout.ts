import type { WorkflowDefinition } from '../../../../shared/mam/domain/workflow'
import type { WorkflowVisualAnalysis } from './mam-workflow-visual-analysis'

export type WorkflowPoint = Readonly<{ x: number; y: number }>

const COLUMN_GAP = 260
const ROW_GAP = 150
const NODE_WIDTH = 190
const NODE_HEIGHT = 110

export function layoutWorkflow(
  analysis: WorkflowVisualAnalysis,
  definition: WorkflowDefinition
): ReadonlyMap<string, WorkflowPoint> {
  const pinned = definition.presentation?.pinnedPositions ?? {}
  const rows = new Map<string, number>()
  const incoming = new Map(definition.nodes.map((node) => [node.id, [] as string[]]))
  for (const [from, targets] of analysis.baseOutgoing) {
    for (const to of targets) incoming.get(to)?.push(from)
  }
  const ordered = [...definition.nodes].sort(
    (a, b) =>
      (analysis.ranks.get(a.id) ?? 0) - (analysis.ranks.get(b.id) ?? 0) || a.id.localeCompare(b.id)
  )
  const branchRows = new Map<string, number>()
  for (const group of analysis.parallelGroups) {
    ;[...group.branchIds].sort().forEach((id, index) => branchRows.set(id, index))
  }
  for (const node of ordered) {
    const parentRows = (incoming.get(node.id) ?? [])
      .map((id) => rows.get(id))
      .filter((row): row is number => row !== undefined)
    const inherited =
      parentRows.length > 0
        ? Math.round(parentRows.reduce((a, b) => a + b, 0) / parentRows.length)
        : 0
    rows.set(node.id, branchRows.get(node.id) ?? inherited)
  }
  const positions = new Map<string, WorkflowPoint>()
  const occupied: WorkflowPoint[] = Object.values(pinned)
  for (const node of ordered) {
    const fixed = pinned[node.id]
    if (fixed) {
      positions.set(node.id, fixed)
      continue
    }
    const x = (analysis.ranks.get(node.id) ?? 0) * COLUMN_GAP
    const ideal = (rows.get(node.id) ?? 0) * ROW_GAP
    let y = ideal
    for (let offset = 0; occupied.some((point) => overlaps({ x, y }, point)); offset += 1) {
      y = ideal + (offset % 2 === 0 ? 1 : -1) * Math.ceil((offset + 1) / 2) * ROW_GAP
    }
    const point = { x, y }
    positions.set(node.id, point)
    occupied.push(point)
  }
  return positions
}

function overlaps(a: WorkflowPoint, b: WorkflowPoint): boolean {
  return Math.abs(a.x - b.x) < NODE_WIDTH + 24 && Math.abs(a.y - b.y) < NODE_HEIGHT + 30
}
