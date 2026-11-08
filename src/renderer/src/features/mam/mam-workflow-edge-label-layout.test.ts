import { describe, expect, it } from 'vitest'
import { placeWorkflowEdgeLabels } from './mam-workflow-edge-label-layout'
import type { MamWorkflowCanvasEdge, MamWorkflowCanvasNode } from './mam-workflow-canvas-model'

const node = (id: string, x: number, y = 0): MamWorkflowCanvasNode => ({
  id,
  type: 'mam-workflow',
  position: { x, y },
  data: { node: { id, type: 'finish', inputs: [] } }
})

const edge = (
  id: string,
  source: string,
  target: string,
  label: string
): MamWorkflowCanvasEdge => ({
  id,
  source,
  target,
  type: 'mam-motion',
  label
})

describe('workflow edge label layout', () => {
  it('keeps an adjacent control label inside the gap between two cards', () => {
    const nodes = [node('approve-release', 0), node('promote-main', 340)]
    const [placed] = placeWorkflowEdgeLabels(nodes, [
      edge('promote', 'approve-release', 'promote-main', '推广到 main')
    ])
    const label = placed!.data!.labelPlacement!
    expect(label.x - label.maxWidth / 2).toBeGreaterThan(190)
    expect(label.x + label.maxWidth / 2).toBeLessThan(340)
  })

  it('places long artifact labels in separate free lanes away from intervening cards', () => {
    const nodes = [node('producer', 0), node('review', 340), node('merge', 680)]
    const edges = [
      edge('artifact-one', 'producer', 'merge', 'artifact.game-implementation · 可能提供'),
      edge('artifact-two', 'producer', 'merge', 'artifact.game-implementation · 可能提供')
    ]
    const labels = placeWorkflowEdgeLabels(nodes, edges).map((item) => item.data!.labelPlacement!)
    for (const label of labels) {
      expect(label.x - label.maxWidth / 2).toBeGreaterThan(530)
      expect(label.x + label.maxWidth / 2).toBeLessThan(680)
    }
    expect(Math.abs(labels[0]!.y - labels[1]!.y)).toBeGreaterThan(20)
  })

  it('keeps distinct artifact labels visible when one relation spans several nodes', () => {
    const nodes = [node('producer', 0), node('review', 340), node('merge', 680)]
    const [first, second] = placeWorkflowEdgeLabels(nodes, [
      edge('first', 'producer', 'merge', 'artifact.first · 可能提供'),
      edge('second', 'producer', 'merge', 'artifact.second · 可能提供')
    ])
    const left = first!.data!.labelPlacement!
    const right = second!.data!.labelPlacement!
    expect(Math.abs(left.y - right.y)).toBeGreaterThan(20)
  })

  it('moves labels above stacked nodes when no horizontal gap is available', () => {
    const nodes = [node('source', 0), node('middle', 200), node('target', 400)]
    const [placed] = placeWorkflowEdgeLabels(nodes, [
      edge('artifact', 'source', 'target', 'artifact.game-implementation · 可能提供')
    ])
    expect(placed!.data!.labelPlacement!.y).toBeLessThan(0)
  })
})
