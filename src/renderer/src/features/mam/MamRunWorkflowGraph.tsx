import { Background, Controls, ReactFlow, ViewportPortal } from '@xyflow/react'
import { useMemo, useState } from 'react'
import type { WorkflowDefinition } from '../../../../shared/mam/domain/workflow'
import type { MamUiRunSnapshot } from '../../../../shared/mam/ui-projection'
import { Button } from '../../components/ui/button'
import { MamWorkflowCanvasNodeView } from './MamWorkflowCanvasNode'
import { MamWorkflowReturnEdge } from './MamWorkflowReturnEdge'
import { MamWorkflowMotionEdge } from './MamWorkflowMotionEdge'
import { useMamWorkflowMotion } from './use-mam-workflow-motion'
import { workflowParallelRegions } from './mam-workflow-parallel-regions'
import { runWorkflowCanvasModel } from './mam-run-workflow-view-model'

const nodeTypes = { 'mam-workflow': MamWorkflowCanvasNodeView }
const edgeTypes = { 'mam-return': MamWorkflowReturnEdge, 'mam-motion': MamWorkflowMotionEdge }

export function MamRunWorkflowGraph({
  run,
  definition
}: Readonly<{ run: MamUiRunSnapshot; definition: WorkflowDefinition }>): React.JSX.Element {
  const [mode, setMode] = useState<'control' | 'artifact'>('control')
  const motion = useMamWorkflowMotion()
  const model = useMemo(() => runWorkflowCanvasModel(run, definition), [run, definition])
  const regions = useMemo(
    () => workflowParallelRegions(definition, model.nodes),
    [definition, model.nodes]
  )
  const edges =
    mode === 'control'
      ? model.controlEdges
      : [
          ...model.controlEdges.map((edge) => ({
            ...edge,
            label: undefined,
            selectable: false,
            style: { opacity: 0.16 }
          })),
          ...model.dataEdges
        ]
  const displayEdges = edges.map((edge) => ({
    ...edge,
    data: {
      ...edge.data,
      motionEnabled:
        motion.enabled &&
        (mode === 'control' ? Boolean(edge.data?.edge) : edge.data?.motionKind === 'artifact')
    }
  }))
  return (
    <section className="border-b border-border px-4 py-4" aria-label="运行流程图">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h3 className="text-sm font-semibold">运行流程图</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            基于本次运行冻结的工作流定义与节点状态。
          </p>
        </div>
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
          产物引用
        </Button>
        <Button
          size="xs"
          variant={motion.live ? 'secondary' : 'ghost'}
          onClick={() => motion.setLive(!motion.live)}
        >
          {motion.live ? '暂停动效' : '播放动效'}
        </Button>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        {mode === 'artifact'
          ? '虚线表示产物引用匹配；动效仅演示方向，不证明执行器实际读取。'
          : '节点状态来自运行快照；动效仅演示路径方向，不表示实时执行进度。'}
      </p>
      <div
        className={
          motion.enabled
            ? 'mam-flow-live h-96 overflow-hidden rounded-lg border border-border bg-background'
            : 'h-96 overflow-hidden rounded-lg border border-border bg-background'
        }
      >
        <ReactFlow
          nodes={model.nodes}
          edges={displayEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.18 }}
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
