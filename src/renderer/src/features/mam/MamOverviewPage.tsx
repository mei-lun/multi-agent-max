import { AlertTriangle, FolderGit2, GitMerge, Network, Users } from 'lucide-react'
import type { MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'

export function MamOverviewPage({
  snapshot,
  pending,
  onChooseProject
}: Readonly<{
  snapshot: MamUiSnapshot
  pending: boolean
  onChooseProject(): void
}>): React.JSX.Element {
  const mergeEntries = snapshot.runs.flatMap((run) => run.mergeQueueEntries)
  const activeRuns = snapshot.runs.filter((run) => run.run.status !== 'completed')
  return (
    <section aria-labelledby="overview-title" className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <div className="space-y-1">
        <h1 id="overview-title" className="text-xl font-semibold">
          Workflow overview
        </h1>
        <p className="text-sm text-muted-foreground">
          Git-authoritative roles, runs, reviews, and integration state.
        </p>
      </div>

      {snapshot.projectBinding && (
        <ProjectBinding
          binding={snapshot.projectBinding}
          pending={pending}
          onChooseProject={onChooseProject}
        />
      )}

      {snapshot.issues.length > 0 && (
        <div className="space-y-2 rounded-xl border border-destructive bg-card p-4 text-card-foreground">
          <div className="flex items-center gap-2 text-sm font-medium text-destructive">
            <AlertTriangle className="size-4" />
            State requires attention
          </div>
          {snapshot.issues.map((issue) => (
            <p key={`${issue.workflowRunId ?? 'global'}:${issue.code}`} className="text-xs">
              {issue.workflowRunId ? `${issue.workflowRunId}: ` : ''}
              {issue.message}
            </p>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard icon={Users} label="Active roles" value={snapshot.roles.length} />
        <SummaryCard icon={Network} label="Workflows" value={snapshot.workflows.length} />
        <SummaryCard icon={Network} label="Active runs" value={activeRuns.length} />
        <SummaryCard icon={GitMerge} label="Merge entries" value={mergeEntries.length} />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Runs</h2>
          <span className="text-xs text-muted-foreground">{snapshot.runs.length} total</span>
        </div>
        {snapshot.runs.length === 0 ? (
          <EmptyPanel
            connected={Boolean(snapshot.projectBinding)}
            pending={pending}
            onChooseProject={onChooseProject}
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {snapshot.runs.map((run) => (
              <div
                key={run.run.id}
                className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0"
              >
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm font-medium">{run.definitionName}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{run.run.id}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {run.attempts.length} Attempts
                  </span>
                  <Badge variant={run.run.status === 'completed' ? 'success' : 'secondary'}>
                    {run.run.status.replaceAll('_', ' ')}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function ProjectBinding({
  binding,
  pending,
  onChooseProject
}: Readonly<{
  binding: NonNullable<MamUiSnapshot['projectBinding']>
  pending: boolean
  onChooseProject(): void
}>): React.JSX.Element {
  return (
    <section
      aria-label="Connected project"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <FolderGit2 className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium">Connected project</p>
          <p
            data-i18n-skip
            title={binding.projectDirectory}
            className="truncate font-mono text-xs text-muted-foreground"
          >
            {binding.projectDirectory}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge data-i18n-skip variant="outline">
          {binding.remote ? `${binding.remote}/${binding.branch}` : `Local/${binding.branch}`}
        </Badge>
        <Button variant="outline" size="xs" disabled={pending} onClick={onChooseProject}>
          Change project
        </Button>
      </div>
    </section>
  )
}

function SummaryCard({
  icon: Icon,
  label,
  value
}: Readonly<{
  icon: typeof Users
  label: string
  value: number
}>): React.JSX.Element {
  return (
    <div className="rounded-xl border border-border bg-card p-4 text-card-foreground">
      <div className="mb-3 flex items-center justify-between text-muted-foreground">
        <span className="text-xs">{label}</span>
        <Icon className="size-4" />
      </div>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function EmptyPanel({
  connected,
  pending,
  onChooseProject
}: Readonly<{
  connected: boolean
  pending: boolean
  onChooseProject(): void
}>): React.JSX.Element {
  return (
    <div className="rounded-xl border border-dashed border-border p-8 text-center">
      <p className="text-sm font-medium">
        {connected ? 'No Workflow Runs yet' : 'No Workflow Runs are loaded'}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {connected
          ? 'The project is connected. Create a Workflow Definition, then start a Run.'
          : 'Choose a Git project to attach its authoritative MAM state.'}
      </p>
      {!connected && (
        <Button className="mt-4" size="sm" disabled={pending} onClick={onChooseProject}>
          Choose project
        </Button>
      )}
    </div>
  )
}
