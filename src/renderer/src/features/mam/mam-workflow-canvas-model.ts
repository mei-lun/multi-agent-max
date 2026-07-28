import type { Edge, Node } from '@xyflow/react'
import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode
} from '../../../../shared/mam/domain/workflow'

export type MamWorkflowCanvasData = Record<string, unknown> & Readonly<{ node: WorkflowNode }>
export type MamWorkflowCanvasNode = Node<MamWorkflowCanvasData, 'mam-workflow'>
export type MamWorkflowCanvasEdge = Edge<Readonly<{ edge: WorkflowEdge }>>

export const workflowNodeTypes: WorkflowNode['type'][] = [
  'role_task',
  'dynamic_tasks',
  'review_gate',
  'approval_gate',
  'condition',
  'parallel',
  'join',
  'artifact_transform',
  'command',
  'git_merge',
  'finish'
]

export function toCanvasNodes(definition: WorkflowDefinition): MamWorkflowCanvasNode[] {
  const positions = workflowLayout(definition)
  return definition.nodes.map((node, index) => ({
    id: node.id,
    type: 'mam-workflow',
    position: positions.get(node.id) ?? { x: (index % 3) * 240, y: Math.floor(index / 3) * 140 },
    data: { node }
  }))
}

function workflowLayout(
  definition: WorkflowDefinition
): ReadonlyMap<string, Readonly<{ x: number; y: number }>> {
  const nodeIds = new Set(definition.nodes.map((node) => node.id))
  const incoming = new Map(definition.nodes.map((node) => [node.id, 0]))
  const outgoing = new Map(definition.nodes.map((node) => [node.id, [] as string[]]))
  const ranks = new Map(definition.nodes.map((node) => [node.id, 0]))
  for (const edge of definition.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue
    outgoing.get(edge.from)!.push(edge.to)
    incoming.set(edge.to, incoming.get(edge.to)! + 1)
  }
  const queue = [...incoming].filter(([, count]) => count === 0).map(([id]) => id)
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index]!
    for (const next of outgoing.get(id) ?? []) {
      ranks.set(next, Math.max(ranks.get(next) ?? 0, (ranks.get(id) ?? 0) + 1))
      const remaining = incoming.get(next)! - 1
      incoming.set(next, remaining)
      if (remaining === 0) queue.push(next)
    }
  }
  const rowByRank = new Map<number, number>()
  return new Map(
    definition.nodes.map((node) => {
      const rank = ranks.get(node.id) ?? 0
      const row = rowByRank.get(rank) ?? 0
      rowByRank.set(rank, row + 1)
      return [node.id, { x: rank * 240, y: row * 140 }] as const
    })
  )
}

export function toCanvasEdges(definition: WorkflowDefinition): MamWorkflowCanvasEdge[] {
  return definition.edges.map((edge, index) => ({
    id: edgeId(edge, index),
    source: edge.from,
    target: edge.to,
    label: edge.when,
    data: { edge },
    type: 'smoothstep'
  }))
}

export function createWorkflowNode(
  type: WorkflowNode['type'],
  id: string,
  roleProfileId?: string
): WorkflowNode {
  const roles = roleProfileId ? [roleProfileId] : []
  const roleSelection = {
    recommendedRoleProfileIds: roles,
    allowedRoleProfileIds: roles
  }
  const output = {
    schemaVersion: '1.0.0' as const,
    artifactType: `artifact.${id}`,
    format: 'json-schema' as const,
    required: true,
    maxBytes: 1_000_000,
    jsonSchema: { type: 'object' }
  }
  const placeholderInput = {
    artifactId: 'artifact.input',
    version: 1,
    contentHash: '0'.repeat(64)
  }
  if (type === 'role_task') {
    return {
      id,
      type,
      ...roleSelection,
      instruction: `Complete ${id}.`,
      workspaceMode: 'write',
      inputs: [],
      outputs: [output]
    }
  }
  if (type === 'dynamic_tasks') {
    return { id, type, ...roleSelection, planContract: output, maxTasks: 20 }
  }
  if (type === 'review_gate') {
    return {
      id,
      type,
      ...roleSelection,
      inputs: [placeholderInput],
      reportContract: output,
      minimumDecisions: 1,
      maxRevisionAttempts: 3
    }
  }
  if (type === 'approval_gate') {
    return { id, type, prompt: `Approve ${id}?`, options: ['Approve', 'Reject'] }
  }
  if (type === 'condition') return { id, type, expression: 'true', branches: {} }
  if (type === 'parallel') return { id, type, branches: ['branch-a', 'branch-b'] }
  if (type === 'join') return { id, type, waitFor: ['branch-a', 'branch-b'] }
  if (type === 'artifact_transform') {
    return { id, type, inputs: [placeholderInput], outputs: [output], transform: 'identity' }
  }
  if (type === 'command') {
    return {
      id,
      type,
      executable: 'git',
      arguments: ['status'],
      workingDirectory: '.',
      outputs: []
    }
  }
  if (type === 'git_merge') {
    return {
      id,
      type,
      ...roleSelection,
      targetBranch: 'main',
      orderBy: 'merge_ready_at',
      strategy: 'no_ff',
      conflictPolicy: 'coordinator_attempt',
      validations: []
    }
  }
  return { id, type: 'finish', inputs: [] }
}

export function renameWorkflowNode(
  definition: WorkflowDefinition,
  previousId: string,
  nextId: string
): WorkflowDefinition {
  const nodes = definition.nodes.map((node) => renameNodeReferences(node, previousId, nextId))
  const edges = definition.edges.map((edge) => ({
    ...edge,
    from: edge.from === previousId ? nextId : edge.from,
    to: edge.to === previousId ? nextId : edge.to
  }))
  return { ...definition, nodes, edges }
}

function renameNodeReferences(
  node: WorkflowNode,
  previousId: string,
  nextId: string
): WorkflowNode {
  const renamed = { ...node, id: node.id === previousId ? nextId : node.id }
  if (renamed.type === 'parallel') {
    return {
      ...renamed,
      branches: renamed.branches.map((id) => (id === previousId ? nextId : id))
    }
  }
  if (renamed.type === 'join') {
    return {
      ...renamed,
      waitFor: renamed.waitFor.map((id) => (id === previousId ? nextId : id))
    }
  }
  if (renamed.type === 'condition') {
    return {
      ...renamed,
      branches: Object.fromEntries(
        Object.entries(renamed.branches).map(([key, id]) => [key, id === previousId ? nextId : id])
      )
    }
  }
  return renamed
}

function edgeId(edge: WorkflowEdge, index: number): string {
  return `${edge.from}:${edge.to}:${index}`
}
