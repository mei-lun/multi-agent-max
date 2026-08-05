import { Download, Loader2, RadioTower } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { MamExportExecutionActivityInput } from '../../../../shared/mam/execution-activity-export'
import type { MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import { Button } from '../../components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { useUiLocale } from '../../i18n/ui-locale'
import { MamLiveNodeCard } from './MamLiveNodeCard'
import {
  filterMamLiveNodes,
  isMamLiveNodeActive,
  mamLiveNodes,
  type MamLiveNodeFilter
} from './mam-live-activity-view-model'

export function MamLiveActivityPage({
  snapshot,
  onExportExecutionActivity
}: Readonly<{
  snapshot: MamUiSnapshot
  onExportExecutionActivity(input: MamExportExecutionActivityInput): Promise<string | undefined>
}>) {
  const [runId, setRunId] = useState(() => preferredRunId(snapshot))
  const [filter, setFilter] = useState<MamLiveNodeFilter>('all')
  const [exporting, setExporting] = useState(false)
  const [exportedPath, setExportedPath] = useState<string>()
  const { locale } = useUiLocale()
  useEffect(() => {
    if (!snapshot.runs.some((candidate) => candidate.run.id === runId)) {
      setRunId(preferredRunId(snapshot))
    }
  }, [runId, snapshot])
  const run = snapshot.runs.find((candidate) => candidate.run.id === runId)
  const definition = run
    ? snapshot.workflows.find(
        (candidate) =>
          candidate.id === run.run.definitionId && candidate.version === run.run.definitionVersion
      )
    : undefined
  const nodes = useMemo(() => (run ? mamLiveNodes(run, definition) : []), [definition, run])
  const visibleNodes = filterMamLiveNodes(nodes, filter)
  const activeCount = nodes.filter(isMamLiveNodeActive).length
  const eventCount = nodes.reduce((total, node) => total + node.activities.length, 0)

  return (
    <section
      aria-labelledby="live-activity-title"
      className="mx-auto w-full max-w-7xl space-y-5 p-6"
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 id="live-activity-title" className="text-xl font-semibold">
              Live activity
            </h1>
            <span className="flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              <span className="size-1.5 animate-pulse rounded-full bg-[var(--status-success)]" />{' '}
              Live
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Watch every node, Role message, tool, command, and execution state in one place.
          </p>
        </div>
        {snapshot.runs.length > 0 && (
          <div className="flex items-center gap-2">
            <Select value={runId} onValueChange={setRunId}>
              <SelectTrigger className="w-72" aria-label="Observed Workflow Run">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {snapshot.runs.map((candidate) => (
                  <SelectItem key={candidate.run.id} value={candidate.run.id}>
                    {candidate.definitionName} · {candidate.run.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {run && (
              <Button
                variant="outline"
                disabled={exporting}
                onClick={async () => {
                  setExporting(true)
                  try {
                    const path = await onExportExecutionActivity({ workflowRunId: run.run.id })
                    if (path) setExportedPath(path)
                  } finally {
                    setExporting(false)
                  }
                }}
              >
                {exporting ? <Loader2 className="animate-spin" /> : <Download />}
                Export Run activity
              </Button>
            )}
          </div>
        )}
      </header>

      {!run ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <RadioTower className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">No Workflow Run to observe</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Start a Run to see node activity here.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <div className="flex gap-5 text-xs text-muted-foreground">
              <span>
                <strong className="font-semibold text-foreground">{nodes.length}</strong> nodes
              </span>
              <span>
                <strong className="font-semibold text-foreground">{activeCount}</strong> active
              </span>
              <span>
                <strong className="font-semibold text-foreground">{eventCount}</strong> events
              </span>
            </div>
            <div className="flex gap-1" role="group" aria-label="Node activity filter">
              {(['all', 'active', 'attention'] as const).map((value) => (
                <Button
                  key={value}
                  size="xs"
                  variant={filter === value ? 'secondary' : 'ghost'}
                  onClick={() => setFilter(value)}
                >
                  {value === 'all'
                    ? 'All nodes'
                    : value === 'active'
                      ? 'Active now'
                      : 'Needs attention'}
                </Button>
              ))}
            </div>
          </div>
          {exportedPath && (
            <p className="truncate text-xs text-muted-foreground">Exported to {exportedPath}</p>
          )}
          {visibleNodes.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border py-12 text-center text-xs text-muted-foreground">
              No nodes match this filter.
            </p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(19rem,1fr))] gap-4">
              {visibleNodes.map((node) => (
                <MamLiveNodeCard
                  key={node.id}
                  node={node}
                  locale={locale}
                  workflowRunId={run.run.id}
                  onExport={onExportExecutionActivity}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function preferredRunId(snapshot: MamUiSnapshot): string {
  return (
    snapshot.runs.find((run) => run.run.status === 'running')?.run.id ??
    snapshot.runs[0]?.run.id ??
    ''
  )
}
