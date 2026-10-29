import { MarkerType } from '@xyflow/react'
import type { WorkflowDefinition } from '../../../../shared/mam/domain/workflow'
import type { MamUiRunSnapshot } from '../../../../shared/mam/ui-projection'
import {
  toCanvasEdges,
  toCanvasNodes,
  type MamWorkflowCanvasEdge,
  type MamWorkflowCanvasNode
} from './mam-workflow-canvas-model'
import { boundArtifactFlows } from './mam-workflow-bound-artifact-flows'

export function runWorkflowCanvasModel(
  run: MamUiRunSnapshot,
  definition: WorkflowDefinition
): Readonly<{
  nodes: MamWorkflowCanvasNode[]
  controlEdges: MamWorkflowCanvasEdge[]
  dataEdges: MamWorkflowCanvasEdge[]
}> {
  const statuses = new Map(run.nodeRuns.map((node) => [node.nodeId, node.status]))
  const nodes = toCanvasNodes(definition, run.roleProfiles).map((node) => ({
    ...node,
    data: {
      ...node.data,
      ...(statuses.has(node.id) ? { status: statuses.get(node.id)! } : {})
    }
  }))
  const controlEdges = toCanvasEdges(definition)
  const dataEdges: MamWorkflowCanvasEdge[] = boundArtifactFlows(run, definition)
    .filter((flow) => flow.status === 'bound' && flow.producerNodeId)
    .map((flow) => ({
      id: flow.id,
      source: flow.producerNodeId!,
      target: flow.consumerNodeId,
      type: 'smoothstep',
      label: `${flow.artifactId} · 引用匹配`,
      style: { stroke: 'var(--foreground)', strokeDasharray: '5 4' },
      markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--foreground)' },
      selectable: false
    }))
  return { nodes, controlEdges, dataEdges }
}
