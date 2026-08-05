import { Loader2, Pause, Play, UsersRound } from 'lucide-react'
import { useState } from 'react'
import type { MamSaveLocalSettingsInput } from '../../../../shared/mam/application-command'
import type { MamLocalSettings } from '../../../../shared/mam/local-settings'
import type { MamUiRunSnapshot } from '../../../../shared/mam/ui-projection'
import { Button } from '../../components/ui/button'
import { nextMamLocalCollaborationAction } from './mam-local-collaboration-plan'

export function MamLocalCollaborationControl({
  run,
  settings,
  roleNames,
  pending,
  executionError,
  onSaveSettings
}: Readonly<{
  run: MamUiRunSnapshot
  settings: MamLocalSettings
  roleNames: ReadonlyMap<string, string>
  pending: boolean
  executionError?: string
  onSaveSettings(input: MamSaveLocalSettingsInput): Promise<void>
}>): React.JSX.Element {
  const [saveError, setSaveError] = useState<string>()
  const roleIds = settings.participatingRoleProfileIds ?? []
  const activeRunIds = settings.automaticWorkflowRunIds ?? []
  const active = activeRunIds.includes(run.run.id)
  const action = nextMamLocalCollaborationAction(run, roleIds)
  const visibleError = executionError ?? saveError
  const status =
    visibleError ?? (active ? activeActionMessage(action) : localRoleSummary(roleIds, roleNames))
  const update = async (enabled: boolean): Promise<void> => {
    const nextRunIds = enabled
      ? [...new Set([...activeRunIds, run.run.id])]
      : activeRunIds.filter((id) => id !== run.run.id)
    setSaveError(undefined)
    try {
      await onSaveSettings({ settings: { ...settings, automaticWorkflowRunIds: nextRunIds } })
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-primary/5 px-4 py-3">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium">
          <UsersRound className="size-4" />{' '}
          {active ? 'Local collaboration is active' : 'Run with local Roles'}
        </p>
        <p
          className={
            visibleError ? 'mt-1 text-xs text-destructive' : 'mt-1 text-xs text-muted-foreground'
          }
        >
          {status}
        </p>
      </div>
      {active ? (
        <Button variant="outline" size="sm" disabled={pending} onClick={() => void update(false)}>
          {pending ? <Loader2 className="animate-spin" /> : <Pause />} Pause
        </Button>
      ) : (
        <Button
          size="sm"
          disabled={
            pending || roleIds.length === 0 || ['completed', 'cancelled'].includes(run.run.status)
          }
          onClick={() => void update(true)}
        >
          {pending ? <Loader2 className="animate-spin" /> : <Play />} Start local collaboration
        </Button>
      )}
    </div>
  )
}

function localRoleSummary(
  roleIds: readonly string[],
  roleNames: ReadonlyMap<string, string>
): string {
  if (roleIds.length === 0) return 'Select one or more Roles on the My Role page first.'
  const names = roleIds.map((id) => roleNames.get(id) ?? id)
  return `${names.length} local Roles ready: ${names.join(', ')}`
}

function activeActionMessage(action: ReturnType<typeof nextMamLocalCollaborationAction>): string {
  if (action.kind === 'wait') return action.message
  if (action.kind === 'assign') return 'Activating the next Task’s fixed Workflow Role…'
  if (action.kind === 'recover') return 'Preparing a safe replacement result automatically…'
  if (action.kind === 'merge') return 'Adding the reviewed result to the project…'
  return 'Starting the next local Role…'
}
