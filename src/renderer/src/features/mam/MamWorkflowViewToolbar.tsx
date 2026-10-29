import { Maximize2, Search } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import type { WorkflowArtifactRelation } from './mam-workflow-artifact-relations'

export function MamWorkflowViewToolbar({
  mode,
  relations,
  selectedNodeId,
  traceDirection,
  nodeQuery,
  onModeChange,
  onTraceChange,
  onNodeQueryChange,
  onFitView
}: Readonly<{
  mode: 'control' | 'data'
  relations: readonly WorkflowArtifactRelation[]
  selectedNodeId?: string
  traceDirection?: 'upstream' | 'downstream'
  nodeQuery: string
  onModeChange(mode: 'control' | 'data'): void
  onTraceChange(direction?: 'upstream' | 'downstream'): void
  onNodeQueryChange(value: string): void
  onFitView(): void
}>): React.JSX.Element {
  const ambiguous = relations.filter((relation) => relation.status === 'ambiguous').length
  const initial = relations.filter((relation) => relation.status === 'initial').length
  const missing = relations.filter((relation) => relation.status === 'missing').length
  return (
    <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-1.5 text-xs">
      <Button
        variant={mode === 'control' ? 'secondary' : 'ghost'}
        size="xs"
        onClick={() => onModeChange('control')}
      >
        控制流
      </Button>
      <Button
        variant={mode === 'data' ? 'secondary' : 'ghost'}
        size="xs"
        onClick={() => onModeChange('data')}
      >
        产物数据流
      </Button>
      <span className="text-muted-foreground">
        {mode === 'data'
          ? '虚线表示定义时可能提供，不代表已发生传输。'
          : '返工线标出条件和最大次数。'}
      </span>
      <label className="ml-auto flex items-center gap-1">
        <Search className="size-3.5 text-muted-foreground" />
        <Input
          aria-label="查找节点"
          className="h-7 w-32 text-xs"
          value={nodeQuery}
          onChange={(event) => onNodeQueryChange(event.target.value)}
          placeholder="查找节点"
        />
      </label>
      <Button variant="ghost" size="xs" onClick={onFitView}>
        <Maximize2 /> 适合画布
      </Button>
      {selectedNodeId && (
        <div className="flex gap-1" aria-label="路径追踪">
          <Button
            variant={traceDirection === 'upstream' ? 'secondary' : 'ghost'}
            size="xs"
            onClick={() => onTraceChange(traceDirection === 'upstream' ? undefined : 'upstream')}
          >
            看上游
          </Button>
          <Button
            variant={traceDirection === 'downstream' ? 'secondary' : 'ghost'}
            size="xs"
            onClick={() =>
              onTraceChange(traceDirection === 'downstream' ? undefined : 'downstream')
            }
          >
            看下游
          </Button>
        </div>
      )}
      {mode === 'data' && (ambiguous > 0 || initial > 0 || missing > 0) && (
        <span className="truncate text-muted-foreground">
          {initial} 初始输入 · {ambiguous} 来源未确定 · {missing} 待核对初始输入
        </span>
      )}
    </div>
  )
}
