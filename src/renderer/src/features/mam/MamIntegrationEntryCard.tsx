import { GitBranch, GitCommit, ShieldCheck } from 'lucide-react'
import type { MamIntegrationItem } from './mam-integration-view-model'
import { Button } from '../../components/ui/button'
import type { UiLocale } from '../../i18n/ui-locale'
import { MamMergeStatusBadge } from './mam-status-badge'

export function MamIntegrationEntryCard({
  item,
  locale,
  pending,
  automatic,
  canExecute,
  onExecute,
  onOpenRun
}: Readonly<{
  item: MamIntegrationItem
  locale: UiLocale
  pending: boolean
  automatic: boolean
  canExecute: boolean
  onExecute(): Promise<void>
  onOpenRun(): void
}>): React.JSX.Element {
  const { run, entry } = item
  const conflict = run.mergeConflictTasks.find((task) => task.id === entry.conflictTaskId)
  const resolution = run.mergeConflictResolutions.find(
    (candidate) => candidate.conflictTaskId === entry.conflictTaskId
  )
  return (
    <article className="rounded-xl border border-border bg-card p-4 text-card-foreground">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{taskName(item)}</h3>
            <MamMergeStatusBadge status={entry.status} />
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {run.definitionName} · {run.run.id}
          </p>
        </div>
        <time className="shrink-0 text-xs text-muted-foreground">
          Ready {new Date(entry.mergeReadyAt).toLocaleString(locale)}
        </time>
      </div>

      <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
        <QueueFact icon={GitBranch} label="Target" value={entry.targetBranch} />
        <QueueFact icon={GitBranch} label="Source" value={entry.sourceBranch} />
        <QueueFact icon={GitCommit} label="Reviewed commit" value={entry.submittedCommit} mono />
        <QueueFact
          icon={ShieldCheck}
          label="Review decisions"
          value={String(entry.reviewDecisionIds.length)}
        />
        <QueueFact
          icon={ShieldCheck}
          label="Validation evidence"
          value={String(Object.keys(entry.validationEvidence).length)}
        />
        {entry.mergeCommit && (
          <QueueFact icon={GitCommit} label="Merge commit" value={entry.mergeCommit} mono />
        )}
      </dl>

      {entry.failureReason && (
        <p className="mt-4 border-t border-border pt-3 text-xs text-destructive">
          {entry.failureReason}
        </p>
      )}
      {conflict && (
        <div className="mt-4 border-t border-border pt-3 text-xs">
          <p className="font-medium">Coordinator conflict lineage</p>
          <p className="mt-1 text-muted-foreground">
            {conflict.conflictingPaths.length} conflicting path
            {conflict.conflictingPaths.length === 1 ? '' : 's'} · Task {conflict.id}
          </p>
          {resolution && (
            <p className="mt-1 text-muted-foreground">
              Resolved by Attempt {resolution.resolutionAttemptId}
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <p className="text-xs text-muted-foreground">
          {automatic && entry.status === 'queued'
            ? 'Local collaboration will integrate this revision automatically.'
            : entryStatusDetail(item)}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="xs" onClick={onOpenRun}>
            Open Run
          </Button>
          {canExecute && !automatic && (
            <Button size="xs" disabled={pending} onClick={() => void onExecute()}>
              Execute next merge
            </Button>
          )}
        </div>
      </div>
    </article>
  )
}

function taskName(item: MamIntegrationItem): string {
  return item.run.tasks.find((task) => task.id === item.entry.taskId)?.title ?? item.entry.taskId
}

function entryStatusDetail(item: MamIntegrationItem): string {
  const { entry } = item
  if (entry.status === 'conflict') return 'A coordinator must resolve the projected conflict Task.'
  if (entry.status === 'failed') return 'Inspect the failure before restarting this Run.'
  if (entry.status === 'merging') return 'Scheduler is integrating and validating this revision.'
  if (entry.status === 'merged') return `Integrated into ${entry.targetBranch}.`
  if (entry.status === 'superseded') return 'A newer revision replaced this queue entry.'
  return 'Ready for Scheduler-controlled integration.'
}

function QueueFact({
  icon: Icon,
  label,
  value,
  mono = false
}: Readonly<{
  icon: typeof GitBranch
  label: string
  value: string
  mono?: boolean
}>): React.JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </dt>
      <dd className={mono ? 'mt-1 truncate font-mono' : 'mt-1 truncate'}>{value}</dd>
    </div>
  )
}
