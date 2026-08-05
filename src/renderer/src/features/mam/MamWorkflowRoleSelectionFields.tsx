import type { RoleProfile } from '../../../../shared/mam/domain/role'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'

export function MamWorkflowRoleSelectionFields({
  roles,
  recommendedRoleProfileIds,
  allowedRoleProfileIds,
  onChange
}: Readonly<{
  roles: readonly RoleProfile[]
  recommendedRoleProfileIds: readonly string[]
  allowedRoleProfileIds: readonly string[]
  onChange(selection: {
    recommendedRoleProfileIds: string[]
    allowedRoleProfileIds: string[]
  }): void
}>): React.JSX.Element {
  const selectedRoleId = allowedRoleProfileIds[0] ?? recommendedRoleProfileIds[0]
  const ids = [
    ...new Set([
      ...roles.map((role) => role.id),
      ...allowedRoleProfileIds,
      ...recommendedRoleProfileIds
    ])
  ]
  const roleById = new Map(roles.map((role) => [role.id, role]))
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <p className="text-xs font-medium">Node Role</p>
        <p className="text-xs text-muted-foreground">
          This Role is fixed by the Workflow and cannot be changed while a Run is executing.
        </p>
      </div>
      {ids.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          Create a Role Profile before binding this node.
        </p>
      ) : (
        <Select
          {...(selectedRoleId ? { value: selectedRoleId } : {})}
          onValueChange={(roleProfileId) =>
            onChange({
              recommendedRoleProfileIds: [roleProfileId],
              allowedRoleProfileIds: [roleProfileId]
            })
          }
        >
          <SelectTrigger className="w-full" aria-label="Node Role">
            <SelectValue placeholder="Select the fixed Role" />
          </SelectTrigger>
          <SelectContent>
            {ids.map((id) => (
              <SelectItem key={id} value={id}>
                {roleById.get(id)?.displayName ?? id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}
