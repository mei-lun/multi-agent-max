import { AlertTriangle, GitCommit, GitMerge, History, Loader2 } from 'lucide-react'
import { useState } from 'react'
import type { MamLocalSettings } from '../../../../shared/mam/local-settings'
import type { MamUiRunSnapshot, MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { useUiLocale } from '../../i18n/ui-locale'
import { MamIntegrationEntryCard } from './MamIntegrationEntryCard'
import {
  mamIntegrationEmptyState,
  mamIntegrationItems,
  mamIntegrationSection,
  mamIntegrationSectionCounts,
  type MamIntegrationItem,
  type MamIntegrationSection
} from './mam-integration-view-model'

const SECTION_COPY: Readonly<
  Record<MamIntegrationSection, { title: string; detail: string; icon: typeof GitMerge }>
> = {
  attention: {
    title: 'Needs attention',
    detail: 'Conflicts and failed integrations require a decision before the Run can continue.',
    icon: AlertTriangle
  },
  integrating: {
    title: 'Integrating now',
    detail: 'Scheduler owns the active Git operation and its validation evidence.',
    icon: Loader2
  },
  queued: {
    title: 'Waiting for integration',
    detail: 'Immutable reviewed revisions in deterministic Scheduler order.',
    icon: GitMerge
  },
  history: {
    title: 'Recent integration history',
    detail: 'Completed and superseded entries remain available for audit.',
    icon: History
  }
}

export function MamMergeQueuePage({
  runs,
  workflows = [],
  localSettings,
  focusedRunId,
  pending,
  onExecuteNextMerge,
  onOpenRun = () => {},
  onOpenRuns = () => {},
  onOpenWorkflows = () => {},
  onOpenReviews = () => {},
  onShowAllRuns = () => {}
}: Readonly<{
  runs: readonly MamUiRunSnapshot[]
  workflows?: MamUiSnapshot['workflows']
  localSettings?: MamLocalSettings
  focusedRunId?: string
  pending: boolean
  onExecuteNextMerge(input: { workflowRunId: string }): Promise<void>
  onOpenRun?(workflowRunId: string): void
  onOpenRuns?(): void
  onOpenWorkflows?(): void
  onOpenReviews?(): void
  onShowAllRuns?(): void
}>): React.JSX.Element {
  const { locale } = useUiLocale()
  const [error, setError] = useState<string>()
  const scopedRuns = runs.filter((run) => !focusedRunId || run.run.id === focusedRunId)
  const focusedRun = focusedRunId ? scopedRuns[0] : undefined
  const allItems = mamIntegrationItems(runs)
  const items = mamIntegrationItems(runs, focusedRunId)
  const counts = mamIntegrationSectionCounts(items)
  const firstQueuedId = allItems.find((item) => item.entry.status === 'queued')?.entry.id
  const automaticRunIds = new Set(localSettings?.automaticWorkflowRunIds ?? [])
  const execute = async (workflowRunId: string): Promise<void> => {
    setError(undefined)
    try {
      await onExecuteNextMerge({ workflowRunId })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <section aria-labelledby="merge-queue-title" className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <PageHeader {...(focusedRun ? { focusedRun } : {})} onShowAllRuns={onShowAllRuns} />
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive p-3 text-xs text-destructive"
        >
          {error}
        </p>
      )}
      {items.length === 0 ? (
        <EmptyIntegrationState
          runs={scopedRuns}
          workflows={workflows}
          onOpenRuns={() => (focusedRunId ? onOpenRun(focusedRunId) : onOpenRuns())}
          onOpenReviews={onOpenReviews}
          onOpenWorkflows={onOpenWorkflows}
        />
      ) : (
        <>
          <IntegrationSummary counts={counts} />
          {(['attention', 'integrating', 'queued', 'history'] as const).map((section) => (
            <IntegrationSection
              key={section}
              section={section}
              items={items.filter((item) => mamIntegrationSection(item) === section)}
              locale={locale}
              pending={pending}
              automaticRunIds={automaticRunIds}
              {...(firstQueuedId ? { firstQueuedId } : {})}
              onExecute={execute}
              onOpenRun={onOpenRun}
            />
          ))}
        </>
      )}
    </section>
  )
}

function PageHeader({
  focusedRun,
  onShowAllRuns
}: Readonly<{ focusedRun?: MamUiRunSnapshot; onShowAllRuns(): void }>): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h1 id="merge-queue-title" className="text-xl font-semibold">
          Integration activity
        </h1>
        <p className="text-sm text-muted-foreground">
          Monitor Scheduler-controlled delivery and resolve integration exceptions across Runs.
        </p>
      </div>
      {focusedRun && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{focusedRun.definitionName}</Badge>
          <Button variant="outline" size="xs" onClick={onShowAllRuns}>
            Show all Runs
          </Button>
        </div>
      )}
    </div>
  )
}

function IntegrationSummary({
  counts
}: Readonly<{ counts: ReturnType<typeof mamIntegrationSectionCounts> }>): React.JSX.Element {
  return (
    <dl className="grid overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-4">
      {(['attention', 'integrating', 'queued', 'history'] as const).map((section) => (
        <div
          key={section}
          className="border-b border-border p-3 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0"
        >
          <dt className="text-xs text-muted-foreground">{SECTION_COPY[section].title}</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">{counts[section]}</dd>
        </div>
      ))}
    </dl>
  )
}

function IntegrationSection({
  section,
  items,
  locale,
  pending,
  automaticRunIds,
  firstQueuedId,
  onExecute,
  onOpenRun
}: Readonly<{
  section: MamIntegrationSection
  items: readonly MamIntegrationItem[]
  locale: ReturnType<typeof useUiLocale>['locale']
  pending: boolean
  automaticRunIds: ReadonlySet<string>
  firstQueuedId?: string
  onExecute(workflowRunId: string): Promise<void>
  onOpenRun(workflowRunId: string): void
}>): React.JSX.Element | null {
  if (items.length === 0) return null
  const copy = SECTION_COPY[section]
  const Icon = copy.icon
  const content = (
    <div className="mt-3 space-y-3">
      {items.map((item) => (
        <MamIntegrationEntryCard
          key={`${item.run.run.id}:${item.entry.id}`}
          item={item}
          locale={locale}
          pending={pending}
          automatic={automaticRunIds.has(item.run.run.id)}
          canExecute={item.entry.id === firstQueuedId}
          onExecute={() => onExecute(item.run.run.id)}
          onOpenRun={() => onOpenRun(item.run.run.id)}
        />
      ))}
    </div>
  )
  if (section === 'history') {
    return (
      <details className="group/history">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold">
          <Icon className="size-4" /> {copy.title} <Badge variant="outline">{items.length}</Badge>
        </summary>
        <p className="mt-1 text-xs text-muted-foreground">{copy.detail}</p>
        {content}
      </details>
    )
  }
  return (
    <section aria-label={copy.title}>
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Icon className={section === 'integrating' ? 'size-4 animate-spin' : 'size-4'} />
        {copy.title} <Badge variant="outline">{items.length}</Badge>
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">{copy.detail}</p>
      {content}
    </section>
  )
}

function EmptyIntegrationState({
  runs,
  workflows,
  onOpenRuns,
  onOpenReviews,
  onOpenWorkflows
}: Readonly<{
  runs: readonly MamUiRunSnapshot[]
  workflows: MamUiSnapshot['workflows']
  onOpenRuns(): void
  onOpenReviews(): void
  onOpenWorkflows(): void
}>): React.JSX.Element {
  const empty = mamIntegrationEmptyState(runs, workflows)
  const action =
    empty.action === 'workflows'
      ? onOpenWorkflows
      : empty.action === 'reviews'
        ? onOpenReviews
        : onOpenRuns
  return (
    <div className="rounded-xl border border-dashed border-border p-10 text-center">
      <GitCommit className="mx-auto mb-3 size-7 text-muted-foreground" />
      <p className="text-sm font-medium">{empty.title}</p>
      <p className="mx-auto mt-1 max-w-lg text-xs text-muted-foreground">{empty.detail}</p>
      <Button className="mt-4" variant="outline" size="sm" onClick={action}>
        {empty.actionLabel}
      </Button>
    </div>
  )
}
