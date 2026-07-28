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

export function MamWorkflowInspector({
  definition,
  roles,
  selectedNode,
  selectedEdge,
  onDefinitionChange,
  onNodeChange,
  onNodeRename,
  onEdgeChange
}: Readonly<{
  definition: WorkflowDefinition
  roles: readonly RoleProfile[]
  selectedNode?: WorkflowNode
  selectedEdge?: WorkflowEdge
  onDefinitionChange(definition: WorkflowDefinition): void
  onNodeChange(node: WorkflowNode): void
  onNodeRename(previousId: string, nextId: string): void
  onEdgeChange(edge: WorkflowEdge): void
}>): React.JSX.Element {
  return (
    <aside className="scrollbar-sleek h-full overflow-y-auto border-l border-border bg-card p-4">
      <div className="space-y-5">
        <WorkflowFields definition={definition} onChange={onDefinitionChange} />
        {selectedNode ? (
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
