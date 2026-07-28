import { GitBranch, GitCommit, ShieldCheck } from 'lucide-react'
import type { MamUiRunSnapshot } from '../../../../shared/mam/ui-projection'
import { MamMergeStatusBadge } from './mam-status-badge'
import { Button } from '../../components/ui/button'
import { useUiLocale } from '../../i18n/ui-locale'

type QueueItem = Readonly<{
  run: MamUiRunSnapshot
  entry: MamUiRunSnapshot['mergeQueueEntries'][number]
}>

export function MamMergeQueuePage({
  runs,
  pending,
  onExecuteNextMerge
}: Readonly<{
  runs: readonly MamUiRunSnapshot[]
  pending: boolean
  onExecuteNextMerge(input: { workflowRunId: string }): Promise<void>
}>): React.JSX.Element {
  const { locale } = useUiLocale()
  const items = runs
    .flatMap((run) => run.mergeQueueEntries.map((entry) => ({ run, entry })))
    .sort(compareQueueItems)
  return (
    <section aria-labelledby="merge-queue-title" className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <div className="space-y-1">
        <h1 id="merge-queue-title" className="text-xl font-semibold">
          Merge Queue
        </h1>
        <p className="text-sm text-muted-foreground">
          Immutable reviewed revisions in Scheduler-controlled integration order.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <GitCommit className="mx-auto mb-3 size-7 text-muted-foreground" />
          <p className="text-sm font-medium">No merge-ready revisions</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Entries appear after Review and validation evidence are current.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(({ run, entry }) => {
            const conflict = run.mergeConflictTasks.find((task) => task.id === entry.conflictTaskId)
            const resolution = run.mergeConflictResolutions.find(
              (candidate) => candidate.conflictTaskId === entry.conflictTaskId
            )
            return (
              <article
                key={`${run.run.id}:${entry.id}`}
                className="rounded-xl border border-border bg-card p-4 text-card-foreground"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-sm font-semibold">{entry.taskId}</h2>
                      <MamMergeStatusBadge status={entry.status} />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {run.definitionName} · {run.run.id}
                    </p>
                  </div>
                  <time className="shrink-0 text-xs text-muted-foreground">
                    {new Date(entry.mergeReadyAt).toLocaleString(locale)}
                  </time>
                </div>

                <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
                  <QueueFact icon={GitBranch} label="Target" value={entry.targetBranch} />
                  <QueueFact icon={GitBranch} label="Source" value={entry.sourceBranch} />
                  <QueueFact
                    icon={GitCommit}
                    label="Reviewed commit"
                    value={entry.submittedCommit}
                    mono
                  />
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
                    <QueueFact
                      icon={GitCommit}
                      label="Merge commit"
                      value={entry.mergeCommit}
                      mono
                    />
                  )}
                </dl>

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
                {entry.status === 'queued' && firstQueuedEntry(run)?.id === entry.id && (
                  <div className="mt-4 border-t border-border pt-3">
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={() => void onExecuteNextMerge({ workflowRunId: run.run.id })}
                    >
                      Execute next merge
                    </Button>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

function firstQueuedEntry(run: MamUiRunSnapshot) {
  return [...run.mergeQueueEntries].sort(compareEntries).find((entry) => entry.status === 'queued')
}

function compareEntries(
  left: MamUiRunSnapshot['mergeQueueEntries'][number],
  right: MamUiRunSnapshot['mergeQueueEntries'][number]
): number {
  return (
    left.mergeReadyAt.localeCompare(right.mergeReadyAt) ||
    left.taskId.localeCompare(right.taskId) ||
    left.id.localeCompare(right.id)
  )
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

function compareQueueItems(left: QueueItem, right: QueueItem): number {
  return (
    left.entry.mergeReadyAt.localeCompare(right.entry.mergeReadyAt) ||
    left.entry.taskId.localeCompare(right.entry.taskId) ||
    left.entry.id.localeCompare(right.entry.id)
  )
}
