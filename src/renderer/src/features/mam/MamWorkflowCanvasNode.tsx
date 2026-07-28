import { Handle, Position, type NodeProps } from '@xyflow/react'
import { GitMerge, Network } from 'lucide-react'
import { cn } from '../../lib/class-name'
import type { MamWorkflowCanvasNode } from './mam-workflow-canvas-model'

export function MamWorkflowCanvasNodeView({
  data,
  selected
}: NodeProps<MamWorkflowCanvasNode>): React.JSX.Element {
  const node = data.node
  const Icon = node.type === 'git_merge' ? GitMerge : Network
  return (
    <div
      className={cn(
        'min-w-40 rounded-lg border border-border bg-card px-3 py-2 text-card-foreground shadow-sm',
        selected && 'ring-2 ring-ring'
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground" />
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 text-muted-foreground" />
        <span className="max-w-32 truncate text-xs font-medium">{node.id}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{node.type.replaceAll('_', ' ')}</p>
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground" />
    </div>
  )
}
