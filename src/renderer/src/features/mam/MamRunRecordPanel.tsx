import { AlertTriangle, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import type {
  MamAssignTaskInput,
  MamCancelWorkflowRunInput,
  MamRecoverAttemptInput,
  MamReassignTaskInput,
  MamRestartWorkflowRunInput,
  MamSaveLocalSettingsInput,
  MamResolveApprovalGateInput,
  MamSelectAttemptInput,
  MamStartAttemptInput
} from '../../../../shared/mam/application-command'
import type {
  MamAttemptDiff,
  MamGetAttemptDiffInput
} from '../../../../shared/mam/attempt-inspection'
import type { MamUiRunSnapshot } from '../../../../shared/mam/ui-projection'
import type { MamLocalSettings } from '../../../../shared/mam/local-settings'
import type { WorkflowDefinition } from '../../../../shared/mam/domain/workflow'
import type { UiLocale } from '../../i18n/ui-locale'
import { MamApprovalGatePanel } from './MamApprovalGatePanel'
import { MamLocalCollaborationControl } from './MamLocalCollaborationControl'
import { MamResetRunDialog } from './MamResetRunDialog'
import { MamRunOutcomePanel } from './MamRunOutcomePanel'
import { MamRunIntegrationPanel } from './MamRunIntegrationPanel'
import { MamRunTaskDetails } from './MamRunTaskDetails'
import { MamStateBadge } from './MamStateBadge'
import { frozenRoleName } from './mam-task-role-candidates'

export function MamRunRecordPanel({
  run,
  roleNames,
  localSettings,
  locale,
  pending,
  defaultOpen,
  onAssignTask,
  onStartAttempt,
  onCancelWorkflowRun,
  onRestartWorkflowRun,
  executionError,
  onSaveLocalSettings,
  onReassignTask,
  onRecoverAttempt,
  onSelectAttempt,
  onGetAttemptDiff,
  onResolveApprovalGate,
  definition,
  onOpenIntegration
}: Readonly<{
  run: MamUiRunSnapshot
  roleNames: ReadonlyMap<string, string>
  localSettings: MamLocalSettings
  locale: UiLocale
  pending: boolean
  defaultOpen: boolean
  onAssignTask(input: MamAssignTaskInput): Promise<void>
  onStartAttempt(input: MamStartAttemptInput): Promise<void>
  onCancelWorkflowRun(input: MamCancelWorkflowRunInput): Promise<void>
  onRestartWorkflowRun(input: MamRestartWorkflowRunInput): Promise<void>
  executionError?: string
  onSaveLocalSettings(input: MamSaveLocalSettingsInput): Promise<void>
  onReassignTask(input: MamReassignTaskInput): Promise<void>
  onRecoverAttempt(input: MamRecoverAttemptInput): Promise<void>
  onSelectAttempt(input: MamSelectAttemptInput): Promise<void>
  onGetAttemptDiff(input: MamGetAttemptDiffInput): Promise<MamAttemptDiff>
  onResolveApprovalGate(input: MamResolveApprovalGateInput): Promise<void>
  definition?: WorkflowDefinition
  onOpenIntegration?(): void
}>): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card">
      <details
        className="group/run"
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open/run:rotate-180" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold">{run.definitionName}</h2>
          </div>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Updated {formatTimestamp(run.run.updatedAt, locale)}
          </span>
          <MamStateBadge status={run.run.status} />
        </summary>

        <div className="border-t border-border">
          <MamLocalCollaborationControl
            run={run}
            settings={localSettings}
            roleNames={roleNames}
            pending={pending}
            {...(executionError ? { executionError } : {})}
            onSaveSettings={onSaveLocalSettings}
          />
          <div className="grid grid-cols-3 border-b border-border bg-muted/30 px-4 py-2 text-xs">
            <RunMetric label="Tasks" value={run.tasks.length} />
            <RunMetric label="Attempts" value={run.attempts.length} />
            <RunMetric label="Ready" value={run.readyTaskIds.length} />
          </div>
          <MamRunOutcomePanel run={run} />
          <MamRunIntegrationPanel
            run={run}
            {...(definition ? { definition } : {})}
            {...(onOpenIntegration ? { onOpenIntegration } : {})}
          />
          {!['completed', 'cancelled'].includes(run.run.status) && (
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <p className="text-xs text-muted-foreground">Wrong setup or want a clean start?</p>
              <MamResetRunDialog
                run={run}
                pending={pending}
                onCancel={onCancelWorkflowRun}
                onRestart={onRestartWorkflowRun}
              />
            </div>
          )}
          <MamApprovalGatePanel run={run} pending={pending} onResolve={onResolveApprovalGate} />
          <RunTasks
            run={run}
            roleNames={roleNames}
            pending={pending}
            onAssignTask={onAssignTask}
            onStartAttempt={onStartAttempt}
            onReassignTask={onReassignTask}
            onRecoverAttempt={onRecoverAttempt}
            onSelectAttempt={onSelectAttempt}
            onGetAttemptDiff={onGetAttemptDiff}
          />
        </div>
      </details>
    </article>
  )
}

function RunTasks({
  run,
  roleNames,
  pending,
  onAssignTask,
  onStartAttempt,
  onReassignTask,
  onRecoverAttempt,
  onSelectAttempt,
  onGetAttemptDiff
}: Readonly<{
  run: MamUiRunSnapshot
  roleNames: ReadonlyMap<string, string>
  pending: boolean
  onAssignTask(input: MamAssignTaskInput): Promise<void>
  onStartAttempt(input: MamStartAttemptInput): Promise<void>
  onReassignTask(input: MamReassignTaskInput): Promise<void>
  onRecoverAttempt(input: MamRecoverAttemptInput): Promise<void>
  onSelectAttempt(input: MamSelectAttemptInput): Promise<void>
  onGetAttemptDiff(input: MamGetAttemptDiffInput): Promise<MamAttemptDiff>
}>): React.JSX.Element {
  if (run.tasks.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-xs text-muted-foreground">
        This Run has no projected Tasks.
      </p>
    )
  }
  return (
    <div>
      {run.tasks.map((task) => {
        const attempts = task.attemptIds.flatMap((attemptId) => {
          const attempt = run.attempts.find((candidate) => candidate.id === attemptId)
          return attempt ? [attempt] : []
        })
        return (
          <details
            key={task.id}
            className="group/task border-b border-border last:border-b-0"
            open={['waiting_role_assignment', 'running', 'needs_attention'].includes(task.status)}
          >
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
              <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open/task:rotate-180" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{taskDisplayTitle(task)}</p>
              </div>
              {task.executionWarningCount > 0 && (
                <span
                  className="flex items-center gap-1 text-xs text-destructive"
                  aria-label={`${task.executionWarningCount} execution warnings`}
                >
                  <AlertTriangle className="size-3.5" /> {task.executionWarningCount}
                </span>
              )}
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {taskRoleName(run, task, roleNames)}
              </span>
              <MamStateBadge status={task.status} />
            </summary>
            <MamRunTaskDetails
              run={run}
              task={task}
              attempts={attempts}
              pending={pending}
              onAssignTask={onAssignTask}
              onStartAttempt={onStartAttempt}
              onReassignTask={onReassignTask}
              onRecoverAttempt={onRecoverAttempt}
              onSelectAttempt={onSelectAttempt}
              onGetAttemptDiff={onGetAttemptDiff}
            />
          </details>
        )
      })}
    </div>
  )
}

function taskDisplayTitle(task: MamUiRunSnapshot['tasks'][number]): string {
  return task.kind === 'review' ? 'Review submitted work' : task.title
}

function taskRoleName(
  run: MamUiRunSnapshot,
  task: MamUiRunSnapshot['tasks'][number],
  roleNames: ReadonlyMap<string, string>
): string {
  if (!task.roleProfileId) return 'Unassigned'
  if (task.roleProfileVersion) {
    return frozenRoleName(run, task.roleProfileId, task.roleProfileVersion)
  }
  return roleNames.get(task.roleProfileId) ?? task.roleProfileId
}

function RunMetric({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <div className="text-center">
      <span className="font-semibold tabular-nums">{value}</span>{' '}
      <span className="text-muted-foreground">{label}</span>
    </div>
  )
}

function formatTimestamp(value: string, locale: UiLocale): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}
