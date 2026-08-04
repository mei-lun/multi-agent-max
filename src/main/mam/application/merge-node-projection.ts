import type { NodeRun } from '../../../shared/mam/domain/workflow'
import type { WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'
import type { WorkflowRunProjection } from '../state-store/git-event-projection'
import { projectWorkflowRoute } from './workflow-route-projection'

export function mergeNodeHasCompleted(
  mergeNodeId: string,
  projection: WorkflowRunProjection,
  bundle: WorkflowRunBundle
): boolean {
  const entries = mergeNodeEntries(mergeNodeId, projection)
  const expectedTaskIds = mergeSourceTaskIds(bundle, projection, mergeNodeId)
  return (
    entries.length > 0 &&
    entries.every((entry) => entry.status === 'merged') &&
    expectedTaskIds.every((taskId) =>
      entries.some((entry) => entry.taskId === taskId && entry.status === 'merged')
    )
  )
}

export function mergeNodeRun(
  original: NodeRun,
  mergeNodeId: string,
  projection: WorkflowRunProjection,
  bundle: WorkflowRunBundle
): NodeRun {
  const entries = mergeNodeEntries(mergeNodeId, projection)
  if (entries.some((entry) => entry.status === 'conflict' || entry.status === 'failed')) {
    return { ...original, status: 'blocked' }
  }
  if (entries.some((entry) => entry.status === 'merging')) {
    return { ...original, status: 'running' }
  }
  if (mergeNodeHasCompleted(mergeNodeId, projection, bundle)) {
    return { ...original, status: 'passed' }
  }
  return { ...original, status: 'ready' }
}

function mergeSourceTaskIds(
  bundle: WorkflowRunBundle,
  projection: WorkflowRunProjection,
  mergeNodeId: string
): readonly string[] {
  const ancestors = ancestorNodeIds(bundle, mergeNodeId)
  const cancelled = projectWorkflowRoute(bundle, projection).cancelledNodeIds
  const staticIds = bundle.taskCatalog.flatMap((task) => {
    const node = bundle.definition.nodes.find((candidate) => candidate.id === task.nodeId)
    return node?.type === 'role_task' &&
      node.workspaceMode === 'write' &&
      ancestors.has(node.id) &&
      !cancelled.has(node.id)
      ? [task.id]
      : []
  })
  const dynamicIds = Object.values(projection.dynamicTasks)
    .filter((task) => ancestors.has(task.nodeId) && !cancelled.has(task.nodeId))
    .map((task) => task.id)
  return [...staticIds, ...dynamicIds]
}

function ancestorNodeIds(bundle: WorkflowRunBundle, nodeId: string): ReadonlySet<string> {
  const predecessors = new Map<string, string[]>()
  for (const edge of bundle.definition.edges) {
    predecessors.set(edge.to, [...(predecessors.get(edge.to) ?? []), edge.from])
  }
  const result = new Set<string>()
  const pending = [...(predecessors.get(nodeId) ?? [])]
  while (pending.length > 0) {
    const candidate = pending.shift()!
    if (result.has(candidate)) continue
    result.add(candidate)
    pending.push(...(predecessors.get(candidate) ?? []))
  }
  return result
}

function mergeNodeEntries(mergeNodeId: string, projection: WorkflowRunProjection) {
  return Object.values(projection.mergeQueueEntries).filter(
    (entry) => entry.mergeNodeId === mergeNodeId && entry.status !== 'superseded'
  )
}
