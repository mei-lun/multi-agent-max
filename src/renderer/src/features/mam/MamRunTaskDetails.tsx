import type {
  MamAssignTaskInput,
  MamRecoverAttemptInput,
  MamSelectAttemptInput,
  MamStartAttemptInput
} from '../../../../shared/mam/application-command'
import type {
  MamAttemptDiff,
  MamGetAttemptDiffInput
} from '../../../../shared/mam/attempt-inspection'
import type { MamUiRunSnapshot } from '../../../../shared/mam/ui-projection'
import { Badge } from '../../components/ui/badge'
import { MamStartAttemptDialog } from './MamStartAttemptDialog'
import { MamTaskAttemptLineage } from './MamTaskAttemptLineage'
import { MamTaskContractList } from './MamAttemptPanel'
import { frozenRoleName } from './mam-task-role-candidates'

type Task = MamUiRunSnapshot['tasks'][number]
type Attempt = MamUiRunSnapshot['attempts'][number]

export function MamRunTaskDetails({
  run,
  task,
  attempts,
  pending,
  onAssignTask,
  onStartAttempt,
  onRecoverAttempt,
  onSelectAttempt,
  onGetAttemptDiff
}: Readonly<{
  run: MamUiRunSnapshot
  task: Task
  attempts: readonly Attempt[]
  pending: boolean
  onAssignTask(input: MamAssignTaskInput): Promise<void>
  onStartAttempt(input: MamStartAttemptInput): Promise<void>
  onRecoverAttempt(input: MamRecoverAttemptInput): Promise<void>
  onSelectAttempt(input: MamSelectAttemptInput): Promise<void>
  onGetAttemptDiff(input: MamGetAttemptDiffInput): Promise<MamAttemptDiff>
}>): React.JSX.Element {
  const activeAttemptIds = attempts
    .filter((attempt) => attempt.status === 'announced' || attempt.status === 'running')
    .map((attempt) => attempt.id)
  return (
    <div className="space-y-4 border-t border-border bg-muted/20 px-4 py-4 pl-11">
      <TaskSummary run={run} task={task} />
      {task.specification && <p className="text-sm leading-6">{taskDescription(task)}</p>}
      <TaskAction
        run={run}
        task={task}
        activeAttemptIds={activeAttemptIds}
        pending={pending}
        onAssignTask={onAssignTask}
        onStartAttempt={onStartAttempt}
      />
      <MamTaskAttemptLineage
        attempts={attempts}
        {...(task.selectedAttemptId ? { selectedAttemptId: task.selectedAttemptId } : {})}
        workflowRunId={run.run.id}
        pending={pending}
        onRecoverAttempt={onRecoverAttempt}
        onSelectAttempt={onSelectAttempt}
        onGetAttemptDiff={onGetAttemptDiff}
      />
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer w-fit hover:text-foreground">Technical details</summary>
        <div className="mt-2 space-y-3 rounded-lg border border-border bg-card p-3">
          <p className="break-all font-mono">Task ID: {task.id}</p>
          {task.reusedFrom && (
            <p className="break-all font-mono">
              Reused from: {task.reusedFrom.workflowRunId} · {task.reusedFrom.taskId}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <MamTaskContractList
              label="Inputs"
              values={(task.inputArtifacts ?? []).map(
                (artifact) => `${artifact.artifactId} v${artifact.version}`
              )}
            />
            <MamTaskContractList
              label="Expected outputs"
              values={(task.outputContracts ?? []).map(
                (contract) => `${contract.artifactType} · ${contract.format}`
              )}
            />
          </div>
        </div>
      </details>
    </div>
  )
}

function TaskSummary({ run, task }: Readonly<{ run: MamUiRunSnapshot; task: Task }>) {
  const dependencies = task.dependencies.map(
    (dependency) => run.tasks.find((candidate) => candidate.id === dependency)?.title ?? dependency
  )
  if (task.kind === 'static' && dependencies.length === 0 && !task.reusedFrom) return <></>
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {task.reusedFrom && <Badge variant="secondary">Reused verified result</Badge>}
      {task.kind !== 'static' && task.kind !== 'unknown' && (
        <Badge variant="outline">{taskKindLabel(task.kind)}</Badge>
      )}
      {dependencies.map((dependency) => (
        <Badge key={dependency} variant="secondary">
          Depends on {dependency}
        </Badge>
      ))}
    </div>
  )
}

function TaskAction({
  run,
  task,
  activeAttemptIds,
  pending,
  onAssignTask,
  onStartAttempt
}: Readonly<{
  run: MamUiRunSnapshot
  task: Task
  activeAttemptIds: readonly string[]
  pending: boolean
  onAssignTask(input: MamAssignTaskInput): Promise<void>
  onStartAttempt(input: MamStartAttemptInput): Promise<void>
}>) {
  if (run.run.status === 'cancelled') {
    return <p className="text-xs text-muted-foreground">This Run has ended.</p>
  }
  if (run.run.status === 'completed') return <></>
  if (!task.roleProfileId || !task.roleProfileVersion) {
    const roleId = task.allowedRoleProfileIds[0]
    const roleEntry = run.run.roleCatalog.find((entry) => entry.roleProfileId === roleId)
    if (!roleId || !roleEntry) {
      return <p className="text-xs text-destructive">The fixed Workflow Role is unavailable.</p>
    }
    const roleName = frozenRoleName(run, roleId, roleEntry.roleProfileVersion)
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
        <div>
          <p className="text-sm font-medium">Workflow Role: {roleName}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            This Role was fixed when the Workflow was designed.
          </p>
        </div>
        {task.status === 'waiting_role_assignment' && (
          <MamStartAttemptDialog
            input={{ workflowRunId: run.run.id, taskId: task.id }}
            activeAttemptIds={activeAttemptIds}
            pending={pending}
            onStart={async (input) => {
              await onAssignTask({
                workflowRunId: run.run.id,
                taskId: task.id,
                roleProfileId: roleId,
                roleProfileVersion: roleEntry.roleProfileVersion
              })
              await onStartAttempt(input)
            }}
          />
        )}
      </div>
    )
  }
  const canStart = ['ready', 'changes_requested', 'running'].includes(task.status)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-xs">
      <span className="text-muted-foreground">
        Workflow Role: {frozenRoleName(run, task.roleProfileId, task.roleProfileVersion)} · v
        {task.roleProfileVersion}
      </span>
      <div className="flex flex-wrap gap-2">
        {canStart && activeAttemptIds.length === 0 && (
          <MamStartAttemptDialog
            input={{ workflowRunId: run.run.id, taskId: task.id }}
            activeAttemptIds={activeAttemptIds}
            pending={pending}
            onStart={onStartAttempt}
          />
        )}
      </div>
    </div>
  )
}

function taskKindLabel(kind: Task['kind']): string {
  if (kind === 'review') return 'Review Task'
  if (kind === 'dynamic') return 'Generated Task'
  if (kind === 'merge_conflict') return 'Merge conflict'
  return 'Task'
}

function taskDescription(task: Task): string {
  if (task.kind === 'review') {
    return 'Check the submitted work against its inputs and expected outputs, then produce the review report.'
  }
  return task.specification ?? ''
}
