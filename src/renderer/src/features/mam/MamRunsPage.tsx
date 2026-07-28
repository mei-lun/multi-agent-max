import { AlertTriangle, ChevronDown, History } from 'lucide-react'
import type {
  MamRecoverAttemptInput,
  MamResolveApprovalGateInput,
  MamSelectAttemptInput
} from '../../../../shared/mam/application-command'
import type { MamUiRunSnapshot, MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import type {
  MamAttemptDiff,
  MamGetAttemptDiffInput
} from '../../../../shared/mam/attempt-inspection'
import { Badge } from '../../components/ui/badge'
import { useUiLocale, type UiLocale } from '../../i18n/ui-locale'
import { MamStateBadge } from './MamStateBadge'
import { MamAttemptPanel, MamTaskContractList } from './MamAttemptPanel'
import { MamApprovalGatePanel } from './MamApprovalGatePanel'

export function MamRunsPage({
  runs,
  roles,
  pending,
  onRecoverAttempt,
  onSelectAttempt,
  onGetAttemptDiff,
  onResolveApprovalGate
}: Readonly<{
  runs: MamUiSnapshot['runs']
  roles: MamUiSnapshot['roles']
  pending: boolean
  onRecoverAttempt(input: MamRecoverAttemptInput): Promise<void>
  onSelectAttempt(input: MamSelectAttemptInput): Promise<void>
  onGetAttemptDiff(input: MamGetAttemptDiffInput): Promise<MamAttemptDiff>
  onResolveApprovalGate(input: MamResolveApprovalGateInput): Promise<void>
}>): React.JSX.Element {
  const roleNames = new Map(roles.map((role) => [role.id, role.displayName]))
  const sortedRuns = [...runs].sort((left, right) =>
    right.run.updatedAt.localeCompare(left.run.updatedAt)
  )
  return (
    <section aria-labelledby="runs-title" className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <div className="space-y-1">
        <h1 id="runs-title" className="text-xl font-semibold">
          Runs
        </h1>
        <p className="text-sm text-muted-foreground">
          Task state and Attempt lineage rebuilt from authoritative Git events.
        </p>
      </div>

      {sortedRuns.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <History className="mx-auto mb-3 size-7 text-muted-foreground" />
          <p className="text-sm font-medium">No Workflow Runs</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Attach a project with MAM state from Overview to inspect run history.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedRuns.map((run) => (
            <RunPanel
              key={run.run.id}
              run={run}
              roleNames={roleNames}
              pending={pending}
              onRecoverAttempt={onRecoverAttempt}
              onSelectAttempt={onSelectAttempt}
              onGetAttemptDiff={onGetAttemptDiff}
              onResolveApprovalGate={onResolveApprovalGate}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function RunPanel({
  run,
  roleNames,
  pending,
  onRecoverAttempt,
  onSelectAttempt,
  onGetAttemptDiff,
  onResolveApprovalGate
}: Readonly<{
  run: MamUiRunSnapshot
  roleNames: ReadonlyMap<string, string>
  pending: boolean
  onRecoverAttempt(input: MamRecoverAttemptInput): Promise<void>
  onSelectAttempt(input: MamSelectAttemptInput): Promise<void>
  onGetAttemptDiff(input: MamGetAttemptDiffInput): Promise<MamAttemptDiff>
  onResolveApprovalGate(input: MamResolveApprovalGateInput): Promise<void>
}>): React.JSX.Element {
  const { locale } = useUiLocale()
  return (
    <article className="overflow-hidden rounded-xl border border-border">
      <header className="flex flex-wrap items-start justify-between gap-3 bg-card px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{run.definitionName}</h2>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{run.run.id}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Updated {formatTimestamp(run.run.updatedAt, locale)}
          </span>
          <MamStateBadge status={run.run.status} />
        </div>
      </header>

      <div className="grid grid-cols-3 border-y border-border bg-muted/30 px-4 py-2 text-xs">
        <RunMetric label="Tasks" value={run.tasks.length} />
        <RunMetric label="Attempts" value={run.attempts.length} />
        <RunMetric label="Ready" value={run.readyTaskIds.length} />
      </div>

      <MamApprovalGatePanel run={run} pending={pending} onResolve={onResolveApprovalGate} />

      {run.tasks.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          This Run has no projected Tasks.
        </p>
      ) : (
        <div>
          {run.tasks.map((task) => {
            const attempts = task.attemptIds.flatMap((attemptId) => {
              const attempt = run.attempts.find((candidate) => candidate.id === attemptId)
              return attempt ? [attempt] : []
            })
            return (
              <details key={task.id} className="group border-b border-border last:border-b-0">
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{task.title}</p>
                    <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                      {task.id}
                    </p>
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
                    {task.roleProfileId
                      ? (roleNames.get(task.roleProfileId) ?? task.roleProfileId)
                      : 'Unassigned'}
                  </span>
                  <MamStateBadge status={task.status} />
                </summary>

                <div className="space-y-3 border-t border-border bg-muted/20 px-4 py-4 pl-11">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{task.kind.replaceAll('_', ' ')}</Badge>
                    {task.dependencies.map((dependency) => (
                      <Badge key={dependency} variant="secondary">
                        depends on {dependency}
                      </Badge>
                    ))}
                  </div>
                  {task.specification && <p className="text-xs">{task.specification}</p>}
                  <div className="grid gap-3 text-xs sm:grid-cols-2">
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
                  {attempts.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No Attempts recorded.</p>
                  ) : (
                    <ol className="space-y-3 border-l border-border pl-4">
                      {attempts.map((attempt, index) => (
                        <li key={attempt.id} className="relative">
                          <span className="absolute top-2 -left-[1.22rem] size-2 rounded-full border border-border bg-card" />
                          <MamAttemptPanel
                            workflowRunId={run.run.id}
                            attempt={attempt}
                            selected={task.selectedAttemptId === attempt.id}
                            latest={index === attempts.length - 1}
                            pending={pending}
                            onRecoverAttempt={onRecoverAttempt}
                            onSelectAttempt={onSelectAttempt}
                            onGetAttemptDiff={onGetAttemptDiff}
                          />
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </details>
            )
          })}
        </div>
      )}
    </article>
  )
}

function RunMetric({
  label,
  value
}: Readonly<{ label: string; value: number }>): React.JSX.Element {
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
