import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  CircleCheck,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Network,
  ShieldCheck,
  UserCheck,
  Workflow
} from 'lucide-react'
import { cn } from '../../lib/class-name'
import { MamStateBadge } from './MamStateBadge'
import type { MamWorkflowCanvasNode } from './mam-workflow-canvas-model'

const nodeLabels: Record<string, string> = {
  role_task: '角色任务',
  dynamic_tasks: '动态任务',
  review_gate: '角色审核',
  review_aggregate: '审核汇总',
  approval_gate: '人工批准',
  human_review_gate: '人工审阅',
  condition: '条件分支',
  parallel: '并行分叉',
  join: '并行汇合',
  artifact_transform: '产物转换',
  command: '本地命令',
  git_merge: 'Git 合并',
  finish: '完成'
}

export function MamWorkflowCanvasNodeView({
  data,
  selected
}: NodeProps<MamWorkflowCanvasNode>): React.JSX.Element {
  const node = data.node
  const Icon =
    node.type === 'git_merge'
      ? GitMerge
      : node.type === 'parallel'
        ? GitBranch
        : node.type === 'join'
          ? GitPullRequest
          : node.type === 'condition'
            ? Workflow
            : node.type === 'finish'
              ? CircleCheck
              : node.type === 'approval_gate' || node.type === 'human_review_gate'
                ? UserCheck
                : node.type === 'review_gate' || node.type === 'review_aggregate'
                  ? ShieldCheck
                  : Network
  return (
    <div
      className={cn(
        'w-[190px] rounded-lg border border-border bg-card px-3 py-2 text-card-foreground shadow-sm',
        selected && 'ring-2 ring-ring'
      )}
      aria-label={`${nodeLabels[node.type] ?? node.type}: ${node.id}`}
    >
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground" />
      <Handle
        id="return-target"
        type="target"
        position={Position.Top}
        className="!bg-ring"
        style={{ left: '30%' }}
      />
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-xs font-medium">{node.id}</span>
      </div>
      {data.status && (
        <div className="mt-1">
          <MamStateBadge status={data.status} />
        </div>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">{nodeLabels[node.type] ?? node.type}</p>
      {data.roleName && (
        <p className="mt-1 truncate text-[11px] text-muted-foreground">{data.roleName}</p>
      )}
      {node.type === 'join' && (
        <p className="mt-1 truncate text-[11px] text-muted-foreground">
          等待 {node.waitFor.join('、')}
        </p>
      )}
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground" />
      <Handle
        id="return-source"
        type="source"
        position={Position.Top}
        className="!bg-ring"
        style={{ left: '70%' }}
      />
    </div>
  )
}
