import type { NodeRun } from '../../../shared/mam/domain/workflow'
import type { WorkflowRunProjection } from '../state-store/git-event-projection'

export function mergeNodeHasCompleted(
  mergeNodeId: string,
  projection: WorkflowRunProjection
): boolean {
  const entries = mergeNodeEntries(mergeNodeId, projection)
  return entries.length > 0 && entries.every((entry) => entry.status === 'merged')
}

export function mergeNodeRun(
  original: NodeRun,
  mergeNodeId: string,
  projection: WorkflowRunProjection
): NodeRun {
  const entries = mergeNodeEntries(mergeNodeId, projection)
  if (entries.some((entry) => entry.status === 'conflict' || entry.status === 'failed')) {
    return { ...original, status: 'blocked' }
  }
  if (entries.some((entry) => entry.status === 'merging')) {
    return { ...original, status: 'running' }
  }
  return { ...original, status: 'ready' }
}

function mergeNodeEntries(mergeNodeId: string, projection: WorkflowRunProjection) {
  return Object.values(projection.mergeQueueEntries).filter(
    (entry) => entry.mergeNodeId === mergeNodeId && entry.status !== 'superseded'
  )
}
