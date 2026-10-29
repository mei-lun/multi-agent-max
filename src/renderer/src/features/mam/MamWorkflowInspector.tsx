import type { RoleProfile } from '../../../../shared/mam/domain/role'
import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode
} from '../../../../shared/mam/domain/workflow'
import { Input } from '../../components/ui/input'
import { MamWorkflowEdgeInspector } from './MamWorkflowEdgeInspector'
import { MamWorkflowLabeledField, MamWorkflowNumberField } from './MamWorkflowFieldControls'
import { MamWorkflowNodeInspector } from './MamWorkflowNodeInspector'
import type { WorkflowArtifactRelation } from './mam-workflow-artifact-relations'

export function MamWorkflowInspector({
  definition,
  roles,
  selectedNode,
  selectedEdge,
  selectedArtifact,
  artifactRelations,
  onArtifactSelect,
  onDefinitionChange,
  onNodeChange,
  onNodeRename,
  onEdgeChange
}: Readonly<{
  definition: WorkflowDefinition
  roles: readonly RoleProfile[]
  selectedNode?: WorkflowNode
  selectedEdge?: WorkflowEdge
  selectedArtifact?: WorkflowArtifactRelation
  artifactRelations?: readonly WorkflowArtifactRelation[]
  onArtifactSelect?(id: string): void
  onDefinitionChange(definition: WorkflowDefinition): void
  onNodeChange(node: WorkflowNode): void
  onNodeRename(previousId: string, nextId: string): void
  onEdgeChange(edge: WorkflowEdge): void
}>): React.JSX.Element {
  return (
    <aside className="scrollbar-sleek h-full overflow-y-auto border-l border-border bg-card p-4">
      <div className="space-y-5">
        <WorkflowFields definition={definition} onChange={onDefinitionChange} />
        {selectedArtifact ? (
          <div className="space-y-2 border-t border-border pt-4 text-xs">
            <h2 className="text-sm font-semibold">产物关系</h2>
            <p className="font-mono">{selectedArtifact.artifactId}</p>
            <p className="text-muted-foreground">
              {selectedArtifact.status === 'possible'
                ? '定义时可能提供；尚无本次 Run 的传输证据。'
                : selectedArtifact.status === 'ambiguous'
                  ? '来源未确定。'
                  : selectedArtifact.status === 'initial'
                    ? '初始输入。'
                    : '定义中未找到生产节点；运行前需核对初始输入。'}
            </p>
            <p>消费节点：{selectedArtifact.targetId}</p>
            <p>候选来源：{selectedArtifact.candidateIds.join('、') || '无'}</p>
            <p>版本：{selectedArtifact.input.version}</p>
            <p className="break-all font-mono text-muted-foreground">
              内容摘要：{selectedArtifact.input.contentHash}
            </p>
          </div>
        ) : selectedNode ? (
          <MamWorkflowNodeInspector
            node={selectedNode}
            roles={roles}
            onChange={onNodeChange}
            onRename={onNodeRename}
          />
        ) : selectedEdge ? (
          <MamWorkflowEdgeInspector edge={selectedEdge} onChange={onEdgeChange} />
        ) : (
          <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
            Select a node or edge to inspect its configuration.
          </div>
        )}
        {artifactRelations && artifactRelations.length > 0 && (
          <div className="space-y-2 border-t border-border pt-4">
            <h2 className="text-sm font-semibold">产物关系</h2>
            {artifactRelations.map((relation) => (
              <button
                key={relation.id}
                type="button"
                className="block w-full rounded border border-border px-2 py-1 text-left text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onArtifactSelect?.(relation.id)}
              >
                <span className="font-mono">{relation.artifactId}</span> → {relation.targetId}
                <span className="ml-2 text-muted-foreground">
                  {relation.status === 'possible'
                    ? `候选：${relation.sourceId}`
                    : relation.status === 'ambiguous'
                      ? '来源未确定'
                      : relation.status === 'initial'
                        ? '初始输入'
                        : '待核对初始输入'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

function WorkflowFields({
  definition,
  onChange
}: Readonly<{
  definition: WorkflowDefinition
  onChange(definition: WorkflowDefinition): void
}>): React.JSX.Element {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Definition</h2>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          {definition.id} · v{definition.version}
        </p>
      </div>
      <MamWorkflowLabeledField label="Name">
        <Input
          value={definition.name}
          onChange={(event) => onChange({ ...definition, name: event.target.value })}
        />
      </MamWorkflowLabeledField>
      <div className="grid grid-cols-2 gap-2">
        <MamWorkflowNumberField
          label="Max transitions"
          value={definition.maxTransitions}
          onChange={(value) => onChange({ ...definition, maxTransitions: value })}
        />
        <MamWorkflowNumberField
          label="Max duration (s)"
          value={definition.maxRunDurationSeconds}
          onChange={(value) => onChange({ ...definition, maxRunDurationSeconds: value })}
        />
      </div>
      <MamWorkflowNumberField
        label="Run budget (USD)"
        value={definition.maxRunCostUsd}
        step="0.01"
        onChange={(value) => onChange({ ...definition, maxRunCostUsd: value })}
      />
    </div>
  )
}
