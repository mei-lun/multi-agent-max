import {
  Background,
  Controls,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection
} from '@xyflow/react'
import { ArrowLeft, Plus, Save } from 'lucide-react'
import { useState } from 'react'
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
import { MamWorkflowInspector } from './MamWorkflowInspector'
import {
  createWorkflowNode,
  renameWorkflowNode,
  toCanvasEdges,
  toCanvasNodes,
  workflowNodeTypes,
  type MamWorkflowCanvasEdge,
  type MamWorkflowCanvasNode
} from './mam-workflow-canvas-model'

const nodeTypes = { 'mam-workflow': MamWorkflowCanvasNodeView }

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
  const [nodes, setNodes, onNodesChange] = useNodesState<MamWorkflowCanvasNode>(
    toCanvasNodes(workflow)
  )
  const [edges, setEdges, onEdgesChange] = useEdgesState<MamWorkflowCanvasEdge>(
    toCanvasEdges(workflow)
  )
  const [selectedNodeId, setSelectedNodeId] = useState<string>()
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>()
  const [newNodeType, setNewNodeType] = useState<WorkflowNode['type']>('role_task')
  const [newNodeId, setNewNodeId] = useState('new-task')
  const [editorError, setEditorError] = useState<string>()
  const selectedNode = definition.nodes.find((node) => node.id === selectedNodeId)
  const selectedCanvasEdge = edges.find((edge) => edge.id === selectedEdgeId)
  const selectedEdge = selectedCanvasEdge?.data?.edge
  const save = async (): Promise<void> => {
    try {
      await onSave({ definition })
    } catch (cause) {
      setEditorError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const connect = (connection: Connection): void => {
    if (!connection.source || !connection.target) return
    if (
      definition.edges.some(
        (edge) => edge.from === connection.source && edge.to === connection.target
      )
    ) {
      setEditorError('That edge already exists.')
      return
    }
    const edge: WorkflowEdge = { from: connection.source, to: connection.target }
    setDefinition((current) => ({ ...current, edges: [...current.edges, edge] }))
    setEdges((current) =>
      addEdge(
        {
          ...connection,
          id: `${connection.source}:${connection.target}:${String(current.length)}`,
          type: 'smoothstep',
          data: { edge }
        },
        current
      )
    )
    setEditorError(undefined)
  }

  const addNode = (): void => {
    const id = newNodeId.trim()
    if (!id || definition.nodes.some((node) => node.id === id)) {
      setEditorError(id ? 'Node ID already exists.' : 'Node ID is required.')
      return
    }
    const node = createWorkflowNode(newNodeType, id, roles[0]?.id)
    setDefinition((current) => ({ ...current, nodes: [...current.nodes, node] }))
    setNodes((current) => [
      ...current,
      {
        id,
        type: 'mam-workflow',
        position: { x: 80 + (current.length % 3) * 240, y: 80 + current.length * 45 },
        data: { node }
      }
    ])
    setSelectedNodeId(id)
    setSelectedEdgeId(undefined)
    setEditorError(undefined)
  }

  const updateNode = (node: WorkflowNode): void => {
    setDefinition((current) => ({
      ...current,
      nodes: current.nodes.map((candidate) => (candidate.id === node.id ? node : candidate))
    }))
    setNodes((current) =>
      current.map((candidate) =>
        candidate.id === node.id ? { ...candidate, data: { node } } : candidate
      )
    )
  }

  const renameNode = (previousId: string, nextId: string): void => {
    if (definition.nodes.some((node) => node.id === nextId)) {
      setEditorError('Node ID already exists.')
      return
    }
    const next = renameWorkflowNode(definition, previousId, nextId)
    setDefinition(next)
    setNodes((current) =>
      current.map((node) =>
        node.id === previousId
          ? { ...node, id: nextId, data: { node: next.nodes.find((item) => item.id === nextId)! } }
          : node
      )
    )
    setEdges(toCanvasEdges(next))
    setSelectedNodeId(nextId)
    setEditorError(undefined)
  }

  const updateEdge = (edge: WorkflowEdge): void => {
    if (!selectedCanvasEdge) return
    const previous = selectedCanvasEdge.data?.edge
    const next = {
      ...definition,
      edges: definition.edges.map((candidate) => (candidate === previous ? edge : candidate))
    }
    setDefinition(next)
    const nextEdges = toCanvasEdges(next)
    setEdges(nextEdges)
    setSelectedEdgeId(
      nextEdges.find(
        (candidate) => candidate.data?.edge.from === edge.from && candidate.data.edge.to === edge.to
      )?.id
    )
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
        <Button size="sm" disabled={pending} onClick={() => void save()}>
          <Save /> {saveLabel}
        </Button>
      </header>
      {editorError && (
        <p role="alert" className="border-b border-destructive px-4 py-2 text-xs text-destructive">
          {editorError}
        </p>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-h-0 bg-background">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            proOptions={{ hideAttribution: true }}
            fitView
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={connect}
            onNodeClick={(_, node) => {
              setSelectedNodeId(node.id)
              setSelectedEdgeId(undefined)
            }}
            onEdgeClick={(_, edge) => {
              setSelectedEdgeId(edge.id)
              setSelectedNodeId(undefined)
            }}
            onNodesDelete={(deleted) => {
              const ids = new Set(deleted.map((node) => node.id))
              setDefinition((current) => ({
                ...current,
                nodes: current.nodes.filter((node) => !ids.has(node.id)),
                edges: current.edges.filter((edge) => !ids.has(edge.from) && !ids.has(edge.to))
              }))
              setEdges((current) =>
                current.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target))
              )
              setSelectedNodeId(undefined)
            }}
            onEdgesDelete={(deleted) => {
              const removed = new Set(deleted.map((edge) => edge.id))
              setDefinition((current) => ({
                ...current,
                edges: current.edges.filter(
                  (_, index) =>
                    !removed.has(
                      `${current.edges[index]!.from}:${current.edges[index]!.to}:${index}`
                    )
                )
              }))
              setSelectedEdgeId(undefined)
            }}
          >
            <Background color="var(--border)" gap={20} />
            <Controls />
          </ReactFlow>
        </div>
        <MamWorkflowInspector
          definition={definition}
          roles={roles}
          {...(selectedNode ? { selectedNode } : {})}
          {...(selectedEdge ? { selectedEdge } : {})}
          onDefinitionChange={setDefinition}
          onNodeChange={updateNode}
          onNodeRename={renameNode}
          onEdgeChange={updateEdge}
        />
      </div>
    </section>
  )
}
