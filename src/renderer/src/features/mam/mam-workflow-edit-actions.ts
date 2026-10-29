import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode
} from '../../../../shared/mam/domain/workflow'
import { renameWorkflowNode } from './mam-workflow-canvas-model'

export function connectWorkflowNodes(
  definition: WorkflowDefinition,
  from: string,
  to: string
): WorkflowDefinition {
  if (definition.edges.some((edge) => edge.from === from && edge.to === to)) {
    throw new Error('That edge already exists.')
  }
  const target = definition.nodes.find((node) => node.id === to)
  const revisionTargetNodeId =
    target?.type === 'human_review_gate' ? nearestUpstreamRoleTaskId(definition, from) : undefined
  const returnEdge: WorkflowEdge | undefined =
    target?.type === 'human_review_gate' && revisionTargetNodeId
      ? {
          from: target.id,
          to: revisionTargetNodeId,
          when: 'changes_requested',
          maxTraversals: target.maxRevisionAttempts
        }
      : undefined
  const existingReturn =
    returnEdge &&
    definition.edges.find(
      (edge) =>
        edge.from === returnEdge.from &&
        edge.to === returnEdge.to &&
        edge.when === 'changes_requested'
    )
  return {
    ...definition,
    nodes: definition.nodes.map((node) =>
      node.id === to && node.type === 'human_review_gate' && revisionTargetNodeId
        ? { ...node, revisionTargetNodeId }
        : node
    ),
    edges: [
      ...definition.edges.filter(
        (edge) => !returnEdge || edge.from !== returnEdge.from || edge.when !== 'changes_requested'
      ),
      { from, to },
      ...(returnEdge ? [existingReturn ?? returnEdge] : [])
    ]
  }
}

export function deleteWorkflowNodes(
  definition: WorkflowDefinition,
  ids: ReadonlySet<string>
): WorkflowDefinition {
  const pinnedPositions = Object.fromEntries(
    Object.entries(definition.presentation?.pinnedPositions ?? {}).filter(([id]) => !ids.has(id))
  )
  return {
    ...definition,
    nodes: definition.nodes.filter((node) => !ids.has(node.id)),
    edges: definition.edges.filter((edge) => !ids.has(edge.from) && !ids.has(edge.to)),
    ...(definition.presentation
      ? { presentation: { ...definition.presentation, pinnedPositions } }
      : {})
  }
}

export function replaceWorkflowNode(
  definition: WorkflowDefinition,
  node: WorkflowNode
): WorkflowDefinition {
  return {
    ...definition,
    nodes: definition.nodes.map((candidate) => (candidate.id === node.id ? node : candidate))
  }
}

export function replaceWorkflowEdge(
  definition: WorkflowDefinition,
  index: number,
  edge: WorkflowEdge
): WorkflowDefinition {
  return {
    ...definition,
    edges: definition.edges.map((candidate, at) => (at === index ? edge : candidate))
  }
}

export function deleteWorkflowEdges(
  definition: WorkflowDefinition,
  indexes: ReadonlySet<number>
): WorkflowDefinition {
  return { ...definition, edges: definition.edges.filter((_, index) => !indexes.has(index)) }
}

export { renameWorkflowNode }

function nearestUpstreamRoleTaskId(
  definition: WorkflowDefinition,
  startingNodeId: string
): string | undefined {
  const nodesById = new Map(definition.nodes.map((node) => [node.id, node]))
  const pending = [startingNodeId]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const nodeId = pending.shift()!
    if (visited.has(nodeId)) continue
    visited.add(nodeId)
    if (nodesById.get(nodeId)?.type === 'role_task') return nodeId
    pending.push(...definition.edges.filter((edge) => edge.to === nodeId).map((edge) => edge.from))
  }
  return undefined
}
