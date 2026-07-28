import { AlertTriangle, UserRoundCheck } from 'lucide-react'
import { useState } from 'react'
import type { MamAssignTaskInput } from '../../../../shared/mam/application-command'
import type { MamStartAttemptInput } from '../../../../shared/mam/application-command'
import type { MamUiRunSnapshot, MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { Button } from '../../components/ui/button'
import { MamStateBadge } from './MamStateBadge'
import { MamStartAttemptDialog } from './MamStartAttemptDialog'

type AssignedTask = Readonly<{
  run: MamUiRunSnapshot
  task: MamUiRunSnapshot['tasks'][number]
}>

export function MamMyRolePage({
  snapshot,
  pending,
  onAssignTask,
  onStartAttempt
}: Readonly<{
  snapshot: MamUiSnapshot
  pending: boolean
  onAssignTask(input: MamAssignTaskInput): void
  onStartAttempt(input: MamStartAttemptInput): Promise<void>
}>): React.JSX.Element {
  const [selectedRoleId, setSelectedRoleId] = useState<string>()
  const activeRoleId = snapshot.roles.some((role) => role.id === selectedRoleId)
    ? selectedRoleId
    : snapshot.roles[0]?.id
  const activeRole = snapshot.roles.find((role) => role.id === activeRoleId)
  const tasks: AssignedTask[] = activeRoleId
    ? snapshot.runs.flatMap((run) =>
        run.tasks
          .filter((task) => task.roleProfileId === activeRoleId)
          .map((task) => ({ run, task }))
      )
    : []
  const availableTasks: AssignedTask[] = activeRole
    ? snapshot.runs.flatMap((run) => {
        const roleAvailable = run.run.roleCatalog.some(
          (entry) =>
            entry.roleProfileId === activeRole.id && entry.roleProfileVersion === activeRole.version
        )
        if (!roleAvailable) return []
        return run.tasks
          .filter(
            (task) =>
              task.status === 'waiting_role_assignment' &&
              task.allowedRoleProfileIds.includes(activeRole.id)
          )
          .map((task) => ({ run, task }))
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
            View Tasks manually assigned to the selected Role Profile.
          </p>
        </div>
        {activeRoleId && (
          <Select value={activeRoleId} onValueChange={setSelectedRoleId}>
            <SelectTrigger aria-label="Current Role">
              <SelectValue placeholder="Select a Role" />
            </SelectTrigger>
            <SelectContent>
              {snapshot.roles.map((role) => (
                <SelectItem key={role.id} value={role.id}>
                  {role.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {!activeRole ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <UserRoundCheck className="mx-auto mb-3 size-7 text-muted-foreground" />
          <p className="text-sm font-medium">No Role is available</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Register an active Role Profile before selecting a local working role.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">{activeRole.displayName}</h2>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">{activeRole.id}</p>
            </div>
            <span className="text-xs text-muted-foreground">{tasks.length} assigned</span>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium text-muted-foreground">Assigned Tasks</h3>
              <span className="text-xs text-muted-foreground">{tasks.length}</span>
            </div>
            {tasks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-8 text-center">
                <p className="text-sm font-medium">No Tasks assigned to this Role</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Tasks appear only after a user assignment is persisted in Git state.
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
                      {task.assignedByUserId && <span>Assigned by {task.assignedByUserId}</span>}
                      {task.executionWarningCount > 0 && (
                        <span className="flex items-center gap-1 text-destructive">
                          <AlertTriangle className="size-3.5" /> {task.executionWarningCount}{' '}
                          concurrent execution warnings
                        </span>
                      )}
                    </div>
                    {(task.status === 'ready' ||
                      task.status === 'changes_requested' ||
                      task.status === 'running') && (
                      <div className="mt-3 flex justify-end">
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
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium text-muted-foreground">Available Tasks</h3>
              <span className="text-xs text-muted-foreground">{availableTasks.length}</span>
            </div>
            {availableTasks.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                No unassigned Tasks accept this Role version.
              </p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                {availableTasks.map(({ run, task }) => (
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
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        onAssignTask({
                          workflowRunId: run.run.id,
                          taskId: task.id,
                          roleProfileId: activeRole.id,
                          roleProfileVersion: activeRole.version
                        })
                      }
                    >
                      Assign to {activeRole.displayName}
                    </Button>
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
