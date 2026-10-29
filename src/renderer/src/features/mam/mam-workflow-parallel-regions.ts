import type { Node } from '@xyflow/react'
import type { WorkflowDefinition } from '../../../../shared/mam/domain/workflow'
import { analyzeWorkflowVisual } from './mam-workflow-visual-analysis'

export type WorkflowParallelRegion = Readonly<{
  id: string
  splitId: string
  joinId: string
  x: number
  y: number
  width: number
  height: number
}>

export function workflowParallelRegions(
  definition: WorkflowDefinition,
  nodes: readonly Node[]
): WorkflowParallelRegion[] {
  const locations = new Map(nodes.map((node) => [node.id, node.position]))
  return analyzeWorkflowVisual(definition).parallelGroups.flatMap((group) => {
    const split = locations.get(group.splitId)
    const join = locations.get(group.joinId)
    const branches = group.branchIds.map((id) => locations.get(id))
    if (!split || !join || branches.some((point) => !point)) return []
    const points = [
      split,
      join,
      ...branches.filter((point): point is { x: number; y: number } => Boolean(point))
    ]
    const left = Math.min(...points.map((point) => point.x)) - 30
    const top = Math.min(...points.map((point) => point.y)) - 36
    const right = Math.max(...points.map((point) => point.x)) + 220
    const bottom = Math.max(...points.map((point) => point.y)) + 108
    return [
      {
        id: `parallel:${group.splitId}:${group.joinId}`,
        splitId: group.splitId,
        joinId: group.joinId,
        x: left,
        y: top,
        width: right - left,
        height: bottom - top
      }
    ]
  })
}
