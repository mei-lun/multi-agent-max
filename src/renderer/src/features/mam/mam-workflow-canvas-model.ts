import { MarkerType, type Edge, type Node } from '@xyflow/react'
import type { RoleProfile } from '../../../../shared/mam/domain/role'
import type { NodeRun } from '../../../../shared/mam/domain/workflow'
import { analyzeWorkflowVisual } from './mam-workflow-visual-analysis'
import { layoutWorkflow } from './mam-workflow-layout'
import { returnEdgeChannels, type ReturnChannel } from './mam-workflow-return-channels'
import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode
} from '../../../../shared/mam/domain/workflow'

export type MamWorkflowCanvasData = Record<string, unknown> &
  Readonly<{ node: WorkflowNode; roleName?: string; status?: NodeRun['status'] }>
export type MamWorkflowCanvasNode = Node<MamWorkflowCanvasData, 'mam-workflow'>
export type MamWorkflowCanvasEdge = Edge<
  Readonly<{ edge?: WorkflowEdge; returnChannel?: ReturnChannel }>
>

export const workflowNodeTypes: WorkflowNode['type'][] = [
  'role_task',
  'dynamic_tasks',
  'review_gate',
  'review_aggregate',
  'approval_gate',
  'human_review_gate',
  'condition',
  'parallel',
  'join',
  'artifact_transform',
  'command',
  'git_merge',
  'finish'
]

export function toCanvasNodes(
  definition: WorkflowDefinition,
  roles: readonly RoleProfile[] = []
): MamWorkflowCanvasNode[] {
  const positions = layoutWorkflow(analyzeWorkflowVisual(definition), definition)
  const roleNames = new Map(roles.map((role) => [role.id, role.displayName]))
  return definition.nodes.map((node, index) => ({
    id: node.id,
    type: 'mam-workflow',
    position: positions.get(node.id) ?? { x: (index % 3) * 240, y: Math.floor(index / 3) * 140 },
    data: {
      node,
      ...('allowedRoleProfileIds' in node
        ? {
            roleName:
              roleNames.get(node.allowedRoleProfileIds[0] ?? '') ?? node.allowedRoleProfileIds[0]
          }
        : {})
    }
  }))
}

export function toCanvasEdges(definition: WorkflowDefinition): MamWorkflowCanvasEdge[] {
  const positions = layoutWorkflow(analyzeWorkflowVisual(definition), definition)
  const channels = returnEdgeChannels(definition, positions)
  return definition.edges.map((edge, index) => ({
    id: edgeId(edge, index),
    source: edge.from,
    target: edge.to,
    label: controlEdgeLabel(definition, edge),
    data: {
      edge,
      ...(edge.maxTraversals && channels.has(index) ? { returnChannel: channels.get(index)! } : {})
    },
    type: edge.maxTraversals ? 'mam-return' : 'smoothstep',
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: edge.maxTraversals ? 'var(--ring)' : 'var(--muted-foreground)'
    },
    ...(edge.maxTraversals ? { sourceHandle: 'return-source', targetHandle: 'return-target' } : {})
  }))
}

function controlEdgeLabel(definition: WorkflowDefinition, edge: WorkflowEdge): string | undefined {
  const source = definition.nodes.find((node) => node.id === edge.from)
  const branch =
    source?.type === 'condition'
      ? Object.entries(source.branches).find(([, target]) => target === edge.to)?.[0]
      : undefined
  const condition = edge.when ?? branch
  return edge.maxTraversals
    ? `${condition ? `${condition} · ` : ''}最多 ${edge.maxTraversals} 次`
    : condition
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
  if (type === 'review_aggregate') {
    return {
      id,
      type,
      reviewNodeIds: ['review-a', 'review-b'],
      producerNodeId: 'producer',
      revisionTargetNodeId: 'producer',
      totalQuorum: 2,
      disagreementPolicy: 'human_decision',
      maxRevisionAttempts: 3
    }
  }
  if (type === 'approval_gate') {
    return { id, type, prompt: `Approve ${id}?`, options: ['Approve', 'Reject'] }
  }
  if (type === 'human_review_gate') {
    return {
      id,
      type,
      inputs: [placeholderInput],
      instructions: `Review ${id} and request clear revisions when needed.`,
      revisionTargetNodeId: 'role-task',
      maxRevisionAttempts: 3
    }
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
      targetBranch: 'develop',
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
  const pinnedPositions = definition.presentation?.pinnedPositions
  const presentation = pinnedPositions
    ? {
        schemaVersion: 1 as const,
        pinnedPositions: Object.fromEntries(
          Object.entries(pinnedPositions).map(([id, point]) => [
            id === previousId ? nextId : id,
            point
          ])
        )
      }
    : definition.presentation
  return { ...definition, nodes, edges, ...(presentation ? { presentation } : {}) }
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
  if (renamed.type === 'human_review_gate') {
    return {
      ...renamed,
      revisionTargetNodeId:
        renamed.revisionTargetNodeId === previousId ? nextId : renamed.revisionTargetNodeId
    }
  }
  return renamed
}

function edgeId(edge: WorkflowEdge, index: number): string {
  return `${edge.from}:${edge.to}:${index}`
}
