import { AlertTriangle, CheckCircle2, CircleDashed, GitMerge, Loader2 } from 'lucide-react'
import type { MergeQueueEntry } from '../../../../shared/mam/domain/merge-queue'
import type { WorkflowDefinition } from '../../../../shared/mam/domain/workflow'
import type { MamUiRunSnapshot } from '../../../../shared/mam/ui-projection'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { MamMergeStatusBadge } from './mam-status-badge'

type IntegrationStage = Readonly<{
  nodeId: string
  targetBranch: string
  entry?: MergeQueueEntry | undefined
}>

export function MamRunIntegrationPanel({
  run,
  definition,
  onOpenIntegration
}: Readonly<{
  run: MamUiRunSnapshot
  definition?: WorkflowDefinition
  onOpenIntegration?(): void
}>): React.JSX.Element | null {
  const stages = integrationStages(run, definition)
  if (stages.length === 0) return null
  const attention = stages.some(
    (stage) => stage.entry?.status === 'conflict' || stage.entry?.status === 'failed'
  )
  return (
    <section className="border-b border-border px-4 py-4" aria-label="Run integration stages">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            {attention ? (
              <AlertTriangle className="size-4 text-destructive" />
            ) : (
              <GitMerge className="size-4" />
            )}
            Integration stages
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Reviewed revisions move through Scheduler-controlled delivery inside this Run.
          </p>
        </div>
        {onOpenIntegration && (
          <Button variant="outline" size="xs" onClick={onOpenIntegration}>
            View integration activity
          </Button>
        )}
      </div>
      <div className="mt-3 divide-y divide-border border-y border-border">
        {stages.map((stage) => (
          <div key={stage.nodeId} className="flex items-center gap-3 py-3">
            <StageIcon {...(stage.entry ? { entry: stage.entry } : {})} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Integrate into {stage.targetBranch}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {integrationStageDetail(run, stage)}
              </p>
            </div>
            {stage.entry ? (
              <MamMergeStatusBadge status={stage.entry.status} />
            ) : (
              <Badge variant="outline">Waiting</Badge>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function integrationStages(
  run: MamUiRunSnapshot,
  definition?: WorkflowDefinition
): readonly IntegrationStage[] {
  const configured =
    definition?.nodes.flatMap((node) =>
      node.type === 'git_merge'
        ? [{ nodeId: node.id, targetBranch: node.targetBranch, entry: latestEntry(run, node.id) }]
        : []
    ) ?? []
  const configuredIds = new Set(configured.map((stage) => stage.nodeId))
  const projected = run.mergeQueueEntries
    .filter((entry) => !configuredIds.has(entry.mergeNodeId))
    .map((entry) => ({ nodeId: entry.mergeNodeId, targetBranch: entry.targetBranch, entry }))
  return [...configured, ...projected]
}

function latestEntry(run: MamUiRunSnapshot, nodeId: string): MergeQueueEntry | undefined {
  return [...run.mergeQueueEntries]
    .filter((entry) => entry.mergeNodeId === nodeId)
    .sort((left, right) => right.mergeReadyAt.localeCompare(left.mergeReadyAt))[0]
}

function integrationStageDetail(run: MamUiRunSnapshot, stage: IntegrationStage): string {
  const entry = stage.entry
  if (!entry) {
    const pendingReview = run.tasks.some(
      (task) => task.kind === 'review' && !['approved', 'completed'].includes(task.status)
    )
    return pendingReview
      ? 'Waiting for Review and current validation evidence.'
      : 'Waiting for upstream Workflow prerequisites.'
  }
  if (entry.status === 'conflict') return 'A projected conflict Task requires coordinator work.'
  if (entry.status === 'failed') return entry.failureReason ?? 'Integration failed.'
  if (entry.status === 'merging')
    return 'Scheduler is merging and validating the reviewed revision.'
  if (entry.status === 'queued') return `Reviewed commit ${entry.submittedCommit} is ready.`
  if (entry.status === 'merged') return `Merge commit ${entry.mergeCommit} completed this stage.`
  return `A newer commit ${entry.supersededByCommit} replaced this revision.`
}

function StageIcon({ entry }: Readonly<{ entry?: MergeQueueEntry }>): React.JSX.Element {
  if (entry?.status === 'merged') return <CheckCircle2 className="size-4 shrink-0" />
  if (entry?.status === 'merging') return <Loader2 className="size-4 shrink-0 animate-spin" />
  if (entry?.status === 'failed' || entry?.status === 'conflict') {
    return <AlertTriangle className="size-4 shrink-0 text-destructive" />
  }
  return <CircleDashed className="size-4 shrink-0 text-muted-foreground" />
}
