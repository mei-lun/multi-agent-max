import { WorkflowEdgeSchema, type WorkflowEdge } from '../../../../shared/mam/domain/workflow'
import { Input } from '../../components/ui/input'
import { MamWorkflowAdvancedSource } from './MamWorkflowAdvancedSource'
import { MamWorkflowLabeledField, MamWorkflowNumberField } from './MamWorkflowFieldControls'

export function MamWorkflowEdgeInspector({
  edge,
  onChange
}: Readonly<{
  edge: WorkflowEdge
  onChange(edge: WorkflowEdge): void
}>): React.JSX.Element {
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <h2 className="text-sm font-semibold">Edge Inspector</h2>
      <p className="font-mono text-xs text-muted-foreground">
        {edge.from} → {edge.to}
      </p>
      <MamWorkflowLabeledField
        label="Condition"
        description="Leave empty for an unconditional transition."
      >
        <Input
          className="font-mono"
          value={edge.when ?? ''}
          onChange={(event) => onChange(withOptionalWhen(edge, event.target.value))}
        />
      </MamWorkflowLabeledField>
      <label className="flex items-center gap-2 text-xs font-medium">
        <input
          className="size-3.5 accent-primary"
          type="checkbox"
          checked={edge.maxTraversals !== undefined}
          onChange={(event) => onChange(withTraversalLimit(edge, event.target.checked))}
        />
        Bound this transition
      </label>
      {edge.maxTraversals !== undefined && (
        <MamWorkflowNumberField
          label="Maximum traversals"
          minimum={1}
          value={edge.maxTraversals}
          onChange={(maxTraversals) => onChange({ ...edge, maxTraversals })}
        />
      )}
      <p className="text-xs text-muted-foreground">
        Every cycle must contain an explicitly bounded edge. The Workflow transition budget is a
        separate run-wide guard.
      </p>
      <MamWorkflowAdvancedSource
        value={edge}
        schema={WorkflowEdgeSchema}
        label="Complete edge definition"
        description="Source and target are changed on the canvas, not in JSON."
        validateIdentity={(parsed) => {
          if (parsed.from !== edge.from || parsed.to !== edge.to) {
            throw new Error('Reconnect the edge on the canvas to change its endpoints.')
          }
        }}
        onChange={onChange}
      />
    </div>
  )
}

function withOptionalWhen(edge: WorkflowEdge, value: string): WorkflowEdge {
  const when = value.trim()
  const { when: _, ...base } = edge
  return when ? { ...base, when } : base
}

function withTraversalLimit(edge: WorkflowEdge, enabled: boolean): WorkflowEdge {
  if (enabled) return { ...edge, maxTraversals: edge.maxTraversals ?? 1 }
  const { maxTraversals: _, ...base } = edge
  return base
}
