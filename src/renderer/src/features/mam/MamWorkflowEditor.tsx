import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ViewportPortal,
  useNodesState,
  type ReactFlowInstance,
  type Connection
} from '@xyflow/react'
import { ArrowLeft, Plus, Save, WandSparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { MamSaveWorkflowInput } from '../../../../shared/mam/application-command'
import type { RoleProfile } from '../../../../shared/mam/domain/role'
import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode
} from '../../../../shared/mam/domain/workflow'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { MamWorkflowCanvasNodeView } from './MamWorkflowCanvasNode'
import { MamWorkflowReturnEdge } from './MamWorkflowReturnEdge'
import { MamWorkflowMotionEdge } from './MamWorkflowMotionEdge'
import { MamWorkflowViewToolbar } from './MamWorkflowViewToolbar'
import { useMamWorkflowMotion } from './use-mam-workflow-motion'
import { workflowArtifactRelations } from './mam-workflow-artifact-relations'
import { analyzeWorkflowVisual } from './mam-workflow-visual-analysis'
import { workflowParallelRegions } from './mam-workflow-parallel-regions'
import { reachableWorkflowNodes } from './mam-workflow-reachability'
import { MamWorkflowInspector } from './MamWorkflowInspector'
import {
  connectWorkflowNodes,
  deleteWorkflowEdges,
  deleteWorkflowNodes,
  replaceWorkflowEdge,
  replaceWorkflowNode,
  renameWorkflowNode
} from './mam-workflow-edit-actions'
import {
  createWorkflowNode,
  toCanvasEdges,
  toCanvasNodes,
  workflowNodeTypes,
  type MamWorkflowCanvasEdge,
  type MamWorkflowCanvasNode
} from './mam-workflow-canvas-model'

const nodeTypes = { 'mam-workflow': MamWorkflowCanvasNodeView }
const edgeTypes = { 'mam-return': MamWorkflowReturnEdge, 'mam-motion': MamWorkflowMotionEdge }

export function MamWorkflowEditor({
  workflow,
  roles,
  pending,
  onSave,
  onClose,
  saveLabel = 'Save version',
  versionLabel = `new v${workflow.version}`
}: Readonly<{
  workflow: WorkflowDefinition
  roles: readonly RoleProfile[]
  pending: boolean
  onSave(input: MamSaveWorkflowInput): Promise<void>
  onClose(): void
  saveLabel?: string
  versionLabel?: string
}>): React.JSX.Element {
  const [definition, setDefinition] = useState(workflow)
  const motion = useMamWorkflowMotion()
  const [nodes, setNodes, onNodesChange] = useNodesState<MamWorkflowCanvasNode>(
    toCanvasNodes(workflow, roles)
  )
  const [selectedNodeId, setSelectedNodeId] = useState<string>()
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>()
  const [selectedArtifactId, setSelectedArtifactId] = useState<string>()
  const [newNodeType, setNewNodeType] = useState<WorkflowNode['type']>('role_task')
  const [newNodeId, setNewNodeId] = useState('new-task')
  const [editorError, setEditorError] = useState<string>()
  const [viewMode, setViewMode] = useState<'control' | 'data'>('control')
  const [traceDirection, setTraceDirection] = useState<'upstream' | 'downstream'>()
  const [nodeQuery, setNodeQuery] = useState('')
  const [flowInstance, setFlowInstance] =
    useState<ReactFlowInstance<MamWorkflowCanvasNode, MamWorkflowCanvasEdge>>()
  const selectedNode = definition.nodes.find((node) => node.id === selectedNodeId)
  const edges = useMemo(() => toCanvasEdges(definition), [definition])
  const selectedCanvasEdge = edges.find((edge) => edge.id === selectedEdgeId)
  const selectedEdge = selectedCanvasEdge?.data?.edge
  const artifactRelations = useMemo(() => workflowArtifactRelations(definition), [definition])
  const selectedArtifact = artifactRelations.find((relation) => relation.id === selectedArtifactId)
  const visualDiagnostics = useMemo(
    () => analyzeWorkflowVisual(definition).diagnostics,
    [definition]
  )
  const parallelRegions = useMemo(
    () => workflowParallelRegions(definition, nodes),
    [definition, nodes]
  )
  const tracedNodes = useMemo(() => {
    if (!selectedNodeId || !traceDirection) return undefined
    const relations =
      viewMode === 'control'
        ? definition.edges
        : artifactRelations
            .filter((relation) => relation.sourceId)
            .map((relation) => ({ from: relation.sourceId!, to: relation.targetId }))
    return reachableWorkflowNodes(selectedNodeId, relations, traceDirection)
  }, [selectedNodeId, traceDirection, viewMode, definition, artifactRelations])
  const displayNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        style: {
          ...node.style,
          opacity:
            (tracedNodes && !tracedNodes.has(node.id)) ||
            (nodeQuery && !node.id.toLowerCase().includes(nodeQuery.toLowerCase()))
              ? 0.28
              : 1
        }
      })),
    [nodes, tracedNodes, nodeQuery]
  )
  const visibleEdges = useMemo<MamWorkflowCanvasEdge[]>(
    () =>
      viewMode === 'control'
        ? edges
        : [
            ...edges.map((edge) => ({
              ...edge,
              label: undefined,
              style: { opacity: 0.18 },
              selectable: false,
              deletable: false
            })),
            ...artifactRelations
              .filter((relation) => relation.sourceId)
              .map((relation) => ({
                id: relation.id,
                source: relation.sourceId!,
                target: relation.targetId,
                type: 'mam-motion',
                data: { motionKind: 'artifact' as const },
                label: `${relation.artifactId} · 可能提供`,
                style: { strokeDasharray: '5 4', stroke: 'var(--foreground)' },
                markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--foreground)' },
                selectable: true,
                deletable: false
              }))
          ],
    [artifactRelations, edges, viewMode]
  )
  const displayEdges = useMemo(
    () =>
      visibleEdges.map((edge) => {
        const dimmed =
          tracedNodes && (!tracedNodes.has(edge.source) || !tracedNodes.has(edge.target))
        return {
          ...edge,
          data: {
            ...edge.data,
            motionEnabled:
              motion.enabled &&
              (viewMode === 'control'
                ? Boolean(edge.data?.edge)
                : edge.data?.motionKind === 'artifact')
          },
          style: { ...edge.style, opacity: dimmed ? 0.2 : (edge.style?.opacity ?? 1) }
        }
      }),
    [visibleEdges, tracedNodes, motion.enabled, viewMode]
  )
  const save = async (): Promise<void> => {
    if (visualDiagnostics.some((message) => message.startsWith('固定节点'))) {
      setEditorError('固定节点重叠；请移动节点或使用自动整理。')
      return
    }
    try {
      await onSave({ definition })
    } catch (cause) {
      setEditorError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const updateDefinition = (next: WorkflowDefinition): void => {
    setDefinition(next)
    setNodes(toCanvasNodes(next, roles))
  }

  const resetLayout = (): void => {
    updateDefinition({ ...definition, presentation: { schemaVersion: 1 } })
  }

  const connect = (connection: Connection): void => {
    if (!connection.source || !connection.target) return
    try {
      updateDefinition(connectWorkflowNodes(definition, connection.source, connection.target))
      setEditorError(undefined)
    } catch (cause) {
      setEditorError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const addNode = (): void => {
    const id = newNodeId.trim()
    if (!id || definition.nodes.some((node) => node.id === id)) {
      setEditorError(id ? 'Node ID already exists.' : 'Node ID is required.')
      return
    }
    const node = createWorkflowNode(newNodeType, id, roles[0]?.id)
    updateDefinition({ ...definition, nodes: [...definition.nodes, node] })
    setSelectedNodeId(id)
    setSelectedEdgeId(undefined)
    setEditorError(undefined)
  }

  const updateNode = (node: WorkflowNode): void => {
    updateDefinition(replaceWorkflowNode(definition, node))
  }

  const renameNode = (previousId: string, nextId: string): void => {
    if (definition.nodes.some((node) => node.id === nextId)) {
      setEditorError('Node ID already exists.')
      return
    }
    const next = renameWorkflowNode(definition, previousId, nextId)
    updateDefinition(next)
    setSelectedNodeId(nextId)
    setEditorError(undefined)
  }

  const updateEdge = (edge: WorkflowEdge): void => {
    if (!selectedCanvasEdge) return
    const index = edges.findIndex((candidate) => candidate.id === selectedEdgeId)
    if (index < 0) return
    const next = replaceWorkflowEdge(definition, index, edge)
    updateDefinition(next)
    setSelectedEdgeId(toCanvasEdges(next).find((candidate) => candidate.data?.edge === edge)?.id)
  }

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Workflow editor">
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeft /> Back
        </Button>
        <div className="mr-auto min-w-0">
          <h1 className="truncate text-sm font-semibold">Edit {definition.name}</h1>
          <p className="text-xs text-muted-foreground">
            <span data-i18n-skip className="font-mono">
              {definition.id}
            </span>{' '}
            · {versionLabel}
          </p>
        </div>
        <Input
          aria-label="New node ID"
          className="w-36"
          value={newNodeId}
          onChange={(event) => setNewNodeId(event.target.value)}
        />
        <Select
          value={newNodeType}
          onValueChange={(value) => setNewNodeType(value as WorkflowNode['type'])}
        >
          <SelectTrigger className="w-44" aria-label="New node type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {workflowNodeTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {type.replaceAll('_', ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={addNode}>
          <Plus /> Add node
        </Button>
        <Button variant="outline" size="sm" onClick={resetLayout}>
          <WandSparkles /> 自动整理
        </Button>
        <Button size="sm" disabled={pending} onClick={() => void save()}>
          <Save /> {saveLabel}
        </Button>
      </header>
      {editorError && (
        <p role="alert" className="border-b border-destructive px-4 py-2 text-xs text-destructive">
          {editorError}
        </p>
      )}
      {visualDiagnostics.length > 0 && (
        <p
          className="border-b border-border bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground"
          role="status"
        >
          {visualDiagnostics.join('；')}
        </p>
      )}
      <MamWorkflowViewToolbar
        mode={viewMode}
        relations={artifactRelations}
        nodeQuery={nodeQuery}
        motionLive={motion.live}
        onMotionChange={motion.setLive}
        onNodeQueryChange={setNodeQuery}
        onFitView={() => void flowInstance?.fitView({ padding: 0.15 })}
        {...(selectedNodeId ? { selectedNodeId } : {})}
        {...(traceDirection ? { traceDirection } : {})}
        onModeChange={setViewMode}
        onTraceChange={setTraceDirection}
      />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_21rem]">
        <div
          className={
            motion.enabled ? 'mam-flow-live min-h-0 bg-background' : 'min-h-0 bg-background'
          }
        >
          <ReactFlow
            nodes={displayNodes}
            edges={displayEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            proOptions={{ hideAttribution: true }}
            fitView
            onInit={setFlowInstance}
            onNodesChange={onNodesChange}
            nodesConnectable={viewMode === 'control'}
            nodesDraggable={viewMode === 'control'}
            deleteKeyCode={viewMode === 'control' ? 'Delete' : null}
            onConnect={connect}
            onNodeDragStop={(_, node) => {
              const presentation = definition.presentation ?? { schemaVersion: 1 as const }
              updateDefinition({
                ...definition,
                presentation: {
                  ...presentation,
                  pinnedPositions: { ...presentation.pinnedPositions, [node.id]: node.position }
                }
              })
            }}
            onNodeClick={(_, node) => {
              setSelectedNodeId(node.id)
              setTraceDirection(undefined)
              setSelectedEdgeId(undefined)
              setSelectedArtifactId(undefined)
            }}
            onEdgeClick={(_, edge) => {
              if (edge.id.startsWith('artifact:')) {
                setSelectedArtifactId(edge.id)
                setSelectedEdgeId(undefined)
                setSelectedNodeId(undefined)
                return
              }
              if (!edge.data?.edge) return
              setSelectedEdgeId(edge.id)
              setSelectedNodeId(undefined)
              setSelectedArtifactId(undefined)
            }}
            onNodesDelete={(deleted) => {
              const ids = new Set(deleted.map((node) => node.id))
              updateDefinition(deleteWorkflowNodes(definition, ids))
              setSelectedNodeId(undefined)
              setSelectedEdgeId(undefined)
            }}
            onEdgesDelete={(deleted) => {
              if (viewMode === 'data') return
              const indexes = new Set(
                deleted.map((edge) => edges.findIndex((candidate) => candidate.id === edge.id))
              )
              updateDefinition(deleteWorkflowEdges(definition, indexes))
              setSelectedEdgeId(undefined)
            }}
          >
            <Background color="var(--border)" gap={20} />
            <ViewportPortal>
              {parallelRegions.map((region) => (
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
            <Controls />
          </ReactFlow>
        </div>
        <MamWorkflowInspector
          definition={definition}
          roles={roles}
          {...(selectedNode ? { selectedNode } : {})}
          {...(selectedEdge ? { selectedEdge } : {})}
          {...(selectedArtifact ? { selectedArtifact } : {})}
          {...(viewMode === 'data'
            ? { artifactRelations, onArtifactSelect: setSelectedArtifactId }
            : {})}
          onDefinitionChange={updateDefinition}
          onNodeChange={updateNode}
          onNodeRename={renameNode}
          onEdgeChange={updateEdge}
        />
      </div>
    </section>
  )
}
