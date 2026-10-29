import { Background, Controls, MarkerType, ReactFlow, ViewportPortal } from '@xyflow/react'
import { useMemo, useState } from 'react'
import type { RoleProfile } from '../../../../shared/mam/domain/role'
import type { WorkflowDefinition } from '../../../../shared/mam/domain/workflow'
import { Button } from '../../components/ui/button'
import { MamWorkflowCanvasNodeView } from './MamWorkflowCanvasNode'
import { MamWorkflowReturnEdge } from './MamWorkflowReturnEdge'
import { workflowArtifactRelations } from './mam-workflow-artifact-relations'
import {
  toCanvasEdges,
  toCanvasNodes,
  type MamWorkflowCanvasEdge
} from './mam-workflow-canvas-model'
import { workflowParallelRegions } from './mam-workflow-parallel-regions'

const nodeTypes = { 'mam-workflow': MamWorkflowCanvasNodeView }
const edgeTypes = { 'mam-return': MamWorkflowReturnEdge }

export function MamWorkflowDefinitionPreview({
  definition,
  roles
}: Readonly<{ definition: WorkflowDefinition; roles: readonly RoleProfile[] }>): React.JSX.Element {
  const [mode, setMode] = useState<'control' | 'artifact'>('control')
  const nodes = useMemo(() => toCanvasNodes(definition, roles), [definition, roles])
  const controlEdges = useMemo(() => toCanvasEdges(definition), [definition])
  const relations = useMemo(() => workflowArtifactRelations(definition), [definition])
  const regions = useMemo(() => workflowParallelRegions(definition, nodes), [definition, nodes])
  const artifactEdges: MamWorkflowCanvasEdge[] = relations
    .filter((relation) => relation.status === 'possible' && relation.sourceId)
    .map((relation) => ({
      id: relation.id,
      source: relation.sourceId!,
      target: relation.targetId,
      type: 'smoothstep',
      label: `${relation.artifactId} · 可能提供`,
      style: { stroke: 'var(--foreground)', strokeDasharray: '5 4' },
      markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--foreground)' },
      selectable: false
    }))
  const edges =
    mode === 'control'
      ? controlEdges
      : [
          ...controlEdges.map((edge) => ({
            ...edge,
            label: undefined,
            selectable: false,
            style: { opacity: 0.16 }
          })),
          ...artifactEdges
        ]
  return (
    <section className="border-t border-border bg-background p-4" aria-label="工作流流程图">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="mr-auto font-medium">工作流流程图</span>
        <Button
          size="xs"
          variant={mode === 'control' ? 'secondary' : 'ghost'}
          onClick={() => setMode('control')}
        >
          控制路径
        </Button>
        <Button
          size="xs"
          variant={mode === 'artifact' ? 'secondary' : 'ghost'}
          onClick={() => setMode('artifact')}
        >
          产物关系
        </Button>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        {mode === 'artifact'
          ? '虚线表示定义时可能提供；来源不确定的输入需在节点检查器中核对。'
          : '并行、条件和有界返工按现有工作流定义绘制。'}
      </p>
      <div className="h-80 overflow-hidden rounded-lg border border-border bg-background">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.16 }}
          minZoom={0.35}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          deleteKeyCode={null}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--border)" gap={20} />
          <ViewportPortal>
            {regions.map((region) => (
              <div
                key={region.id}
                aria-hidden="true"
                className="pointer-events-none absolute rounded-xl border border-dashed border-border bg-muted/10"
                style={{
                  left: region.x,
                  top: region.y,
                  width: region.width,
                  height: region.height
                }}
              >
                <span className="absolute -top-5 left-2 text-[11px] text-muted-foreground">
                  并行 · {region.splitId} → {region.joinId}
                </span>
              </div>
            ))}
          </ViewportPortal>
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </section>
  )
}
