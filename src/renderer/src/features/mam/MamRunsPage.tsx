import { History, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import type {
  MamAssignTaskInput,
  MamCancelWorkflowRunInput,
  MamRecoverAttemptInput,
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
import type { MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import type { MamLocalSettings } from '../../../../shared/mam/local-settings'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { useUiLocale } from '../../i18n/ui-locale'
import { MamRunRecordPanel } from './MamRunRecordPanel'
import {
  countMamRunRecords,
  filterMamRunRecords,
  MAM_RUN_RECORD_VIEWS,
  mamRunRecordViewLabel,
  preferredMamRunRecordView,
  type MamRunRecordView
} from './mam-run-record-filter'
import { activateMamLocalCollaboration } from './mam-local-collaboration-settings'

export function MamRunsPage({
  runs,
  roles,
  workflows = [],
  focusedRunId,
  localSettings,
  pending,
  onAssignTask,
  onStartAttempt,
  onCancelWorkflowRun,
  onRestartWorkflowRun,
  collaborationErrors,
  onSaveLocalSettings,
  onRecoverAttempt,
  onSelectAttempt,
  onGetAttemptDiff,
  onResolveApprovalGate,
  onOpenIntegration
}: Readonly<{
  runs: MamUiSnapshot['runs']
  roles: MamUiSnapshot['roles']
  workflows?: MamUiSnapshot['workflows']
  focusedRunId?: string
  localSettings: MamLocalSettings
  pending: boolean
  onAssignTask(input: MamAssignTaskInput): Promise<void>
  onStartAttempt(input: MamStartAttemptInput): Promise<void>
  onCancelWorkflowRun(input: MamCancelWorkflowRunInput): Promise<void>
  onRestartWorkflowRun(input: MamRestartWorkflowRunInput): Promise<MamUiSnapshot>
  collaborationErrors: ReadonlyMap<string, string>
  onSaveLocalSettings(input: MamSaveLocalSettingsInput): Promise<void>
  onRecoverAttempt(input: MamRecoverAttemptInput): Promise<void>
  onSelectAttempt(input: MamSelectAttemptInput): Promise<void>
  onGetAttemptDiff(input: MamGetAttemptDiffInput): Promise<MamAttemptDiff>
  onResolveApprovalGate(input: MamResolveApprovalGateInput): Promise<void>
  onOpenIntegration?(workflowRunId: string): void
}>): React.JSX.Element {
  const [view, setView] = useState<MamRunRecordView>(() =>
    focusedRunId ? 'all' : preferredMamRunRecordView(runs)
  )
  const [query, setQuery] = useState(focusedRunId ?? '')
  useEffect(() => {
    if (!focusedRunId) return
    setView('all')
    setQuery(focusedRunId)
  }, [focusedRunId])
  const { locale } = useUiLocale()
  const roleNames = new Map(roles.map((role) => [role.id, role.displayName]))
  const counts = countMamRunRecords(runs)
  const visibleRuns = filterMamRunRecords(runs, view, query)
  return (
    <section aria-labelledby="runs-title" className="mx-auto w-full max-w-5xl space-y-5 p-6">
      <div className="space-y-1">
        <h1 id="runs-title" className="text-xl font-semibold">
          Runs
        </h1>
        <p className="text-sm text-muted-foreground">
          Separate current work, records that need attention, and immutable history.
        </p>
      </div>

      {runs.length === 0 ? (
        <EmptyRuns />
      ) : (
        <>
          <RunRecordToolbar
            view={view}
            query={query}
            counts={counts}
            onViewChange={setView}
            onQueryChange={setQuery}
          />
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {formatRunCount(visibleRuns.length, runs.length, locale)}
          </p>
          {visibleRuns.length === 0 ? (
            <EmptyFilteredRuns
              query={query}
              view={view}
              onClear={() => {
                setQuery('')
                setView('all')
              }}
            />
          ) : (
            <div className="space-y-3">
              {visibleRuns.map((run, index) => (
                <MamRunRecordPanel
                  key={run.run.id}
                  run={run}
                  roleNames={roleNames}
                  localSettings={localSettings}
                  locale={locale}
                  pending={pending}
                  defaultOpen={index === 0}
                  onAssignTask={onAssignTask}
                  onStartAttempt={onStartAttempt}
                  onCancelWorkflowRun={async (input) => {
                    await onCancelWorkflowRun(input)
                    setQuery('')
                    setView('current')
                  }}
                  onRestartWorkflowRun={async (input) => {
                    const snapshot = await onRestartWorkflowRun(input)
                    const replacement = snapshot.runs.find(
                      (candidate) =>
                        !runs.some((existing) => existing.run.id === candidate.run.id) &&
                        candidate.run.definitionId === run.run.definitionId
                    )
                    if (!replacement) {
                      throw new Error('The replacement Run could not be identified.')
                    }
                    await onSaveLocalSettings({
                      settings: activateMamLocalCollaboration({
                        settings: localSettings,
                        run: replacement,
                        replaceRunId: run.run.id
                      })
                    })
                    setQuery('')
                    setView('current')
                  }}
                  {...(collaborationErrors.get(run.run.id)
                    ? { executionError: collaborationErrors.get(run.run.id)! }
                    : {})}
                  onSaveLocalSettings={onSaveLocalSettings}
                  onRecoverAttempt={onRecoverAttempt}
                  onSelectAttempt={onSelectAttempt}
                  onGetAttemptDiff={onGetAttemptDiff}
                  onResolveApprovalGate={onResolveApprovalGate}
                  {...(workflows.find(
                    (definition) =>
                      definition.id === run.run.definitionId &&
                      definition.version === run.run.definitionVersion
                  )
                    ? {
                        definition: workflows.find(
                          (definition) =>
                            definition.id === run.run.definitionId &&
                            definition.version === run.run.definitionVersion
                        )!
                      }
                    : {})}
                  {...(onOpenIntegration
                    ? { onOpenIntegration: () => onOpenIntegration(run.run.id) }
                    : {})}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function RunRecordToolbar({
  view,
  query,
  counts,
  onViewChange,
  onQueryChange
}: Readonly<{
  view: MamRunRecordView
  query: string
  counts: Readonly<Record<MamRunRecordView, number>>
  onViewChange(view: MamRunRecordView): void
  onQueryChange(value: string): void
}>): React.JSX.Element {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Run status filter">
        {MAM_RUN_RECORD_VIEWS.map((candidate) => (
          <Button
            key={candidate}
            variant={view === candidate ? 'secondary' : 'ghost'}
            size="xs"
            aria-pressed={view === candidate}
            onClick={() => onViewChange(candidate)}
          >
            {mamRunRecordViewLabel(candidate)}
            <Badge variant="outline">{counts[candidate]}</Badge>
          </Button>
        ))}
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8"
          type="search"
          value={query}
          aria-label="Search Runs by workflow or ID"
          placeholder="Search Runs by workflow or ID"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>
    </div>
  )
}

function EmptyRuns(): React.JSX.Element {
  return (
    <div className="rounded-xl border border-dashed border-border p-10 text-center">
      <History className="mx-auto mb-3 size-7 text-muted-foreground" />
      <p className="text-sm font-medium">No Workflow Runs</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Attach a project with MAM state from Overview to inspect run history.
      </p>
    </div>
  )
}

function EmptyFilteredRuns({
  query,
  view,
  onClear
}: Readonly<{
  query: string
  view: MamRunRecordView
  onClear(): void
}>): React.JSX.Element {
  return (
    <div className="rounded-xl border border-dashed border-border p-8 text-center">
      <p className="text-sm font-medium">No matching Run records</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {query
          ? 'Try another workflow name or Run ID.'
          : `There are no ${mamRunRecordViewLabel(view).toLocaleLowerCase()} Run records.`}
      </p>
      <Button className="mt-3" variant="outline" size="xs" onClick={onClear}>
        Show all records
      </Button>
    </div>
  )
}

function formatRunCount(shown: number, total: number, locale: 'en' | 'zh-CN'): string {
  return locale === 'zh-CN'
    ? `显示 ${shown} 条 · 共 ${total} 条`
    : `${shown} shown · ${total} total`
}
