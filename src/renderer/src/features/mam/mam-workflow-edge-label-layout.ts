import type { MamWorkflowCanvasEdge, MamWorkflowCanvasNode } from './mam-workflow-canvas-model'

export type WorkflowEdgeLabelPlacement = Readonly<{ x: number; y: number; maxWidth: number }>

type NodeBounds = Readonly<{
  left: number
  right: number
  top: number
  bottom: number
  centerY: number
}>
type LabelBounds = Readonly<{ x: number; y: number; width: number; height: number }>

const NODE_WIDTH = 190
const NODE_HEIGHT = 110
const LABEL_MARGIN = 8
const MAX_LABEL_WIDTH = 200

export function placeWorkflowEdgeLabels(
  nodes: readonly MamWorkflowCanvasNode[],
  edges: readonly MamWorkflowCanvasEdge[]
): MamWorkflowCanvasEdge[] {
  const bounds = new Map(
    nodes.map((node) => {
      const width = node.measured?.width ?? node.width ?? NODE_WIDTH
      const height = node.measured?.height ?? node.height ?? NODE_HEIGHT
      return [
        node.id,
        {
          left: node.position.x,
          right: node.position.x + width,
          top: node.position.y,
          bottom: node.position.y + height,
          centerY: node.position.y + height / 2
        }
      ] as const
    })
  )
  const nodesInView = [...bounds.values()]
  const reserved: LabelBounds[] = []
  return edges.map((edge) => {
    const source = bounds.get(edge.source)
    const target = bounds.get(edge.target)
    if (edge.type === 'mam-return' || typeof edge.label !== 'string' || !source || !target) {
      return edge
    }

    // Prefer a free horizontal gap on the path, then try nearby rows without covering nodes.
    const gaps = availableGaps(source, target, nodesInView)
    const corridor = gaps.find((gap) => gap.right - gap.left >= 72)
    const maxWidth = corridor
      ? Math.min(MAX_LABEL_WIDTH, corridor.right - corridor.left - LABEL_MARGIN * 2)
      : MAX_LABEL_WIDTH
    const textWidth = estimateLabelWidth(edge.label)
    const width = Math.min(maxWidth, textWidth + 20)
    const x = corridor ? (corridor.left + corridor.right) / 2 : (source.right + target.left) / 2
    const height = estimateLabelHeight(textWidth, width)
    const baseY = corridor
      ? (source.centerY + target.centerY) / 2
      : Math.min(source.top, target.top) - height / 2 - LABEL_MARGIN
    let y = baseY
    for (let lane = 0; collides({ x, y, width, height }, nodesInView, reserved); lane += 1) {
      const step = Math.ceil((lane + 1) / 2)
      y = baseY + (lane % 2 === 0 ? -1 : 1) * step * (height + LABEL_MARGIN)
    }
    reserved.push({ x, y, width, height })
    return { ...edge, data: { ...edge.data, labelPlacement: { x, y, maxWidth: width } } }
  })
}

function availableGaps(
  source: NodeBounds,
  target: NodeBounds,
  nodes: readonly NodeBounds[]
): ReadonlyArray<Readonly<{ left: number; right: number }>> {
  if (source.left >= target.left) return []
  const occupied = nodes
    .filter((node) => node.left >= source.right && node.right <= target.left)
    .sort((left, right) => left.left - right.left)
  const gaps: Array<{ left: number; right: number }> = []
  let cursor = source.right
  for (const node of occupied) {
    if (node.left > cursor) gaps.push({ left: cursor, right: node.left })
    cursor = Math.max(cursor, node.right)
  }
  if (target.left > cursor) gaps.push({ left: cursor, right: target.left })
  return gaps.reverse()
}

function estimateLabelWidth(label: string): number {
  return [...label].reduce((sum, char) => sum + (char.charCodeAt(0) > 127 ? 11 : 6), 0)
}

function estimateLabelHeight(textWidth: number, width: number): number {
  return Math.ceil(textWidth / Math.max(width - 12, 1)) * 14 + 8
}

function collides(
  label: LabelBounds,
  nodes: readonly NodeBounds[],
  reserved: readonly LabelBounds[]
): boolean {
  return (
    nodes.some(
      (node) =>
        label.x + label.width / 2 + LABEL_MARGIN > node.left &&
        label.x - label.width / 2 - LABEL_MARGIN < node.right &&
        label.y + label.height / 2 + LABEL_MARGIN > node.top &&
        label.y - label.height / 2 - LABEL_MARGIN < node.bottom
    ) ||
    reserved.some(
      (other) =>
        Math.abs(label.x - other.x) < (label.width + other.width) / 2 + LABEL_MARGIN &&
        Math.abs(label.y - other.y) < (label.height + other.height) / 2 + LABEL_MARGIN
    )
  )
}
