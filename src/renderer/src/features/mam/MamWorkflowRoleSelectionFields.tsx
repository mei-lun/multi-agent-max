import type { RoleProfile } from '../../../../shared/mam/domain/role'

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
  const roleById = new Map(roles.map((role) => [role.id, role]))
  const ids = [
    ...new Set([
      ...roles.map((role) => role.id),
      ...allowedRoleProfileIds,
      ...recommendedRoleProfileIds
    ])
  ]
  return (
    <fieldset className="space-y-2">
      <div>
        <legend className="text-xs font-medium">Role selection</legend>
        <p className="text-xs text-muted-foreground">
          Allowed roles are eligible for user assignment. Recommendations never assign a task.
        </p>
      </div>
      {ids.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          Create a Role Profile before binding this node.
        </p>
      ) : (
        <div className="space-y-1 rounded-md border border-border p-2">
          {ids.map((id) => {
            const allowed = allowedRoleProfileIds.includes(id)
            const recommended = recommendedRoleProfileIds.includes(id)
            return (
              <div key={id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-1">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">
                    {roleById.get(id)?.displayName ?? id}
                  </p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">{id}</p>
                </div>
                <RoleToggle
                  label="Allowed"
                  checked={allowed}
                  onChange={(checked) =>
                    onChange({
                      allowedRoleProfileIds: toggleId(allowedRoleProfileIds, id, checked),
                      recommendedRoleProfileIds: checked
                        ? [...recommendedRoleProfileIds]
                        : recommendedRoleProfileIds.filter((candidate) => candidate !== id)
                    })
                  }
                />
                <RoleToggle
                  label="Recommended"
                  checked={recommended}
                  onChange={(checked) =>
                    onChange({
                      allowedRoleProfileIds:
                        checked && !allowed
                          ? [...allowedRoleProfileIds, id]
                          : [...allowedRoleProfileIds],
                      recommendedRoleProfileIds: toggleId(recommendedRoleProfileIds, id, checked)
                    })
                  }
                />
              </div>
            )
          })}
        </div>
      )}
    </fieldset>
  )
}

function RoleToggle({
  label,
  checked,
  onChange
}: Readonly<{
  label: string
  checked: boolean
  onChange(checked: boolean): void
}>): React.JSX.Element {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <input
        className="size-3.5 accent-primary"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  )
}

function toggleId(values: readonly string[], id: string, enabled: boolean): string[] {
  if (enabled) return values.includes(id) ? [...values] : [...values, id]
  return values.filter((candidate) => candidate !== id)
}
