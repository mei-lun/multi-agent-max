import { Save, UsersRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { MamSaveLocalSettingsInput } from '../../../../shared/mam/application-command'
import type { MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import { Button } from '../../components/ui/button'
import { MamProfileCheckbox } from './MamProfileFieldControls'

export function MamLocalRoleParticipation({
  snapshot,
  pending,
  onSave
}: Readonly<{
  snapshot: MamUiSnapshot
  pending: boolean
  onSave(input: MamSaveLocalSettingsInput): Promise<void>
}>): React.JSX.Element {
  const configured = snapshot.localSettings.participatingRoleProfileIds ?? []
  const [selected, setSelected] = useState<readonly string[]>(configured)
  const [error, setError] = useState<string>()
  useEffect(() => setSelected(configured), [snapshot.localSettings])
  const changed = selected.join('\0') !== configured.join('\0')
  const save = async (): Promise<void> => {
    setError(undefined)
    try {
      await onSave({
        settings: { ...snapshot.localSettings, participatingRoleProfileIds: [...selected] }
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <UsersRound className="size-4" /> Roles active on this machine
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Select every Role this machine may run. A local collaboration can use all of them.
          </p>
        </div>
        <Button size="sm" disabled={pending || !changed} onClick={() => void save()}>
          <Save /> Save local Roles
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {snapshot.roles.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
          Create Role Profiles before configuring this machine.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {snapshot.roles.map((role) => (
            <MamProfileCheckbox
              key={role.id}
              label={role.displayName}
              description={role.id}
              checked={selected.includes(role.id)}
              onChange={(checked) =>
                setSelected(
                  checked
                    ? [...new Set([...selected, role.id])]
                    : selected.filter((id) => id !== role.id)
                )
              }
            />
          ))}
        </div>
      )}
    </section>
  )
}
