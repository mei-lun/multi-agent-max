import { AlertTriangle, UserRoundCheck } from 'lucide-react'
import { useState } from 'react'
import type {
  MamAssignTaskInput,
  MamSaveLocalSettingsInput,
  MamStartAttemptInput
} from '../../../../shared/mam/application-command'
import type { MamUiRunSnapshot, MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { MamStateBadge } from './MamStateBadge'
import { MamStartAttemptDialog } from './MamStartAttemptDialog'
import { MamLocalRoleParticipation } from './MamLocalRoleParticipation'

type AssignedTask = Readonly<{
  run: MamUiRunSnapshot
  task: MamUiRunSnapshot['tasks'][number]
}>

type AvailableTask = AssignedTask & Readonly<{ roleProfileVersion: number }>

export function MamMyRolePage({
  snapshot,
  pending,
  onAssignTask,
  onStartAttempt,
  onSaveLocalSettings
}: Readonly<{
  snapshot: MamUiSnapshot
  pending: boolean
  onAssignTask(input: MamAssignTaskInput): Promise<void>
  onStartAttempt(input: MamStartAttemptInput): Promise<void>
  onSaveLocalSettings(input: MamSaveLocalSettingsInput): Promise<void>
}>): React.JSX.Element {
  const selectableRoles = [
    ...new Map(
      [...snapshot.runs.flatMap((run) => run.roleProfiles), ...snapshot.roles].map((role) => [
        role.id,
        role
      ])
    ).values()
  ].sort((left, right) => left.displayName.localeCompare(right.displayName))
  const [selectedRoleId, setSelectedRoleId] = useState<string>()
  const activeRoleId = selectableRoles.some((role) => role.id === selectedRoleId)
    ? selectedRoleId
    : selectableRoles[0]?.id
  const activeRole = selectableRoles.find((role) => role.id === activeRoleId)
  const tasks: AssignedTask[] = activeRoleId
    ? snapshot.runs.flatMap((run) =>
        run.tasks
          .filter((task) => task.roleProfileId === activeRoleId)
          .map((task) => ({ run, task }))
      )
    : []
  const availableTasks: AvailableTask[] = activeRole
    ? snapshot.runs.flatMap((run) => {
        const roleEntry = run.run.roleCatalog.find((entry) => entry.roleProfileId === activeRole.id)
        if (!roleEntry) return []
        return run.tasks
          .filter(
            (task) =>
              task.status === 'waiting_role_assignment' &&
              task.allowedRoleProfileIds.length === 1 &&
              task.allowedRoleProfileIds[0] === activeRole.id
          )
          .map((task) => ({ run, task, roleProfileVersion: roleEntry.roleProfileVersion }))
      })
    : []
  return (
    <section aria-labelledby="my-role-title" className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 id="my-role-title" className="text-xl font-semibold">
            My Role
          </h1>
          <p className="text-sm text-muted-foreground">
            View Tasks fixed to the selected Role Profile by their Workflow.
          </p>
        </div>
        {activeRoleId && (
          <Select value={activeRoleId} onValueChange={setSelectedRoleId}>
            <SelectTrigger aria-label="Current Role">
              <SelectValue placeholder="Select a Role" />
            </SelectTrigger>
            <SelectContent>
              {selectableRoles.map((role) => (
                <SelectItem key={role.id} value={role.id}>
                  {role.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <MamLocalRoleParticipation
        snapshot={snapshot}
        pending={pending}
        onSave={onSaveLocalSettings}
      />

      {!activeRole ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <UserRoundCheck className="mx-auto mb-3 size-7 text-muted-foreground" />
          <p className="text-sm font-medium">No Role is available</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create a Role Profile or start a Run with a frozen Role catalog.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">{activeRole.displayName}</h2>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">{activeRole.id}</p>
            </div>
            <span className="text-xs text-muted-foreground">{tasks.length} Workflow Tasks</span>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium text-muted-foreground">Workflow Tasks</h3>
              <span className="text-xs text-muted-foreground">{tasks.length}</span>
            </div>
            {tasks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-8 text-center">
                <p className="text-sm font-medium">No Workflow Tasks for this Role</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Tasks appear when a Workflow node is fixed to this Role.
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                {tasks.map(({ run, task }) => (
                  <article
                    key={`${run.run.id}:${task.id}`}
                    className="border-b border-border px-4 py-3 last:border-b-0"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{task.title}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {run.definitionName} · <span className="font-mono">{task.id}</span>
                        </p>
                      </div>
                      <MamStateBadge status={task.status} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>{task.attemptIds.length} Attempts</span>
                      {task.executionWarningCount > 0 && (
                        <span className="flex items-center gap-1 text-destructive">
                          <AlertTriangle className="size-3.5" /> {task.executionWarningCount}{' '}
                          concurrent execution warnings
                        </span>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                      {(task.status === 'ready' ||
                        task.status === 'changes_requested' ||
                        task.status === 'running') && (
                        <MamStartAttemptDialog
                          input={{ workflowRunId: run.run.id, taskId: task.id }}
                          activeAttemptIds={run.attempts
                            .filter(
                              (attempt) =>
                                attempt.taskId === task.id &&
                                (attempt.status === 'announced' || attempt.status === 'running')
                            )
                            .map((attempt) => attempt.id)}
                          pending={pending}
                          onStart={onStartAttempt}
                        />
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium text-muted-foreground">Ready Tasks</h3>
              <span className="text-xs text-muted-foreground">{availableTasks.length}</span>
            </div>
            {availableTasks.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                No waiting Tasks are fixed to this Role version.
              </p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                {availableTasks.map(({ run, task, roleProfileVersion }) => (
                  <article
                    key={`${run.run.id}:${task.id}`}
                    className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{task.title}</p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {run.definitionName} · <span className="font-mono">{task.id}</span>
                      </p>
                    </div>
                    <MamStartAttemptDialog
                      input={{ workflowRunId: run.run.id, taskId: task.id }}
                      activeAttemptIds={[]}
                      pending={pending}
                      onStart={async (input) => {
                        await onAssignTask({
                          workflowRunId: run.run.id,
                          taskId: task.id,
                          roleProfileId: activeRole.id,
                          roleProfileVersion
                        })
                        await onStartAttempt(input)
                      }}
                    />
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
