import type { RoleProfile } from '../../../../shared/mam/domain/role'
import { WorkflowNodeSchema, type WorkflowNode } from '../../../../shared/mam/domain/workflow'
import { Badge } from '../../components/ui/badge'
import { Input } from '../../components/ui/input'
import { MamWorkflowAdvancedSource } from './MamWorkflowAdvancedSource'
import { MamWorkflowLabeledField } from './MamWorkflowFieldControls'
import { MamWorkflowRoleNodeFields } from './MamWorkflowRoleNodeFields'
import { MamWorkflowSystemNodeFields } from './MamWorkflowSystemNodeFields'

export function MamWorkflowNodeInspector({
  node,
  roles,
  onChange,
  onRename
}: Readonly<{
  node: WorkflowNode
  roles: readonly RoleProfile[]
  onChange(node: WorkflowNode): void
  onRename(previousId: string, nextId: string): void
}>): React.JSX.Element {
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Node Inspector</h2>
        <Badge variant="outline">{node.type.replaceAll('_', ' ')}</Badge>
      </div>
      <MamWorkflowLabeledField
        label="Node ID"
        description="Renaming also updates graph edges and branch references."
      >
        <Input
          defaultValue={node.id}
          key={node.id}
          onBlur={(event) => {
            const nextId = event.target.value.trim()
            if (nextId && nextId !== node.id) onRename(node.id, nextId)
          }}
        />
      </MamWorkflowLabeledField>
      {'recommendedRoleProfileIds' in node ? (
        <MamWorkflowRoleNodeFields node={node} roles={roles} onChange={onChange} />
      ) : (
        <MamWorkflowSystemNodeFields node={node} onChange={onChange} />
      )}
      <MamWorkflowAdvancedSource
        value={node}
        schema={WorkflowNodeSchema}
        label="Complete node definition"
        description="Use this only for exact source-level editing; the fields above remain authoritative."
        validateIdentity={(parsed) => {
          if (parsed.id !== node.id) {
            throw new Error('Use the Node ID field to rename this node and its graph references.')
          }
          if (parsed.type !== node.type) {
            throw new Error('Create a new node to change its type.')
          }
        }}
        onChange={onChange}
      />
    </div>
  )
}
