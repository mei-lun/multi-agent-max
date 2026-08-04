import { AlertTriangle } from 'lucide-react'
import type { MamResolveReviewDisagreementInput } from '../../../../shared/mam/application-command'
import type {
  MamAttemptDiff,
  MamGetAttemptDiffInput
} from '../../../../shared/mam/attempt-inspection'
import type { MamUiRunSnapshot } from '../../../../shared/mam/ui-projection'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { MamReviewEvidence } from './MamReviewEvidence'
import { MamStateBadge } from './MamStateBadge'

export type MamReviewAggregationItem = Readonly<{
  run: MamUiRunSnapshot
  aggregation: MamUiRunSnapshot['reviewAggregations'][number]
}>

export function MamReviewAggregationSection({
  items,
  pending,
  onResolve,
  onGetAttemptDiff
}: Readonly<{
  items: readonly MamReviewAggregationItem[]
  pending: boolean
  onResolve(input: MamResolveReviewDisagreementInput): Promise<void>
  onGetAttemptDiff(input: MamGetAttemptDiffInput): Promise<MamAttemptDiff>
}>): React.JSX.Element {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">System Review summaries</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Calculated from Review decisions; these are not additional reviewers.
          </p>
        </div>
        <span className="text-xs text-muted-foreground">{items.length} total</span>
      </div>
      <div className="space-y-3">
        {items.map(({ run, aggregation }) => {
          const resolution = run.reviewDisagreementResolutions.find(
            (candidate) => candidate.aggregationId === aggregation.id
          )
          return (
            <article
              key={aggregation.id}
              className="space-y-3 rounded-xl border border-border bg-card p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{run.definitionName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Aggregated from {aggregation.sourceDecisionIds.length} Review decisions
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {aggregation.requiresHumanDecision && !resolution && (
                    <Badge variant="destructive">
                      <AlertTriangle className="size-3" /> Human decision
                    </Badge>
                  )}
                  <MamStateBadge status={aggregation.proposedStatus} />
                </div>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{aggregation.classification.replaceAll('_', ' ')}</span>
                <span>{aggregation.findings.length} findings</span>
              </div>
              {resolution ? (
                <p className="text-xs text-muted-foreground">
                  Resolved as{' '}
                  <span className="font-medium text-foreground">
                    {resolution.selectedOption.replaceAll('_', ' ')}
                  </span>{' '}
                  by {resolution.userId}.
                </p>
              ) : aggregation.requiresHumanDecision ? (
                <>
                  <MamReviewEvidence
                    run={run}
                    subject={aggregation.subject}
                    onGetAttemptDiff={onGetAttemptDiff}
                  />
                  <ResolutionButtons
                    runId={run.run.id}
                    aggregationId={aggregation.id}
                    pending={pending}
                    onResolve={onResolve}
                  />
                </>
              ) : null}
              <details className="border-t border-border pt-3 text-xs text-muted-foreground">
                <summary className="w-fit cursor-pointer hover:text-foreground">
                  Technical details
                </summary>
                <p className="mt-2 break-all font-mono">{aggregation.id}</p>
              </details>
            </article>
          )
        })}
      </div>
    </div>
  )
}

function ResolutionButtons({
  runId,
  aggregationId,
  pending,
  onResolve
}: Readonly<{
  runId: string
  aggregationId: string
  pending: boolean
  onResolve(input: MamResolveReviewDisagreementInput): Promise<void>
}>): React.JSX.Element {
  const choose = (selectedStatus: 'approved' | 'changes_requested' | 'blocked'): void => {
    void onResolve({ workflowRunId: runId, aggregationId, selectedStatus })
  }
  return (
    <div className="flex flex-wrap gap-2 border-t border-border pt-3">
      <Button size="xs" disabled={pending} onClick={() => choose('approved')}>
        Approve
      </Button>
      <Button
        variant="outline"
        size="xs"
        disabled={pending}
        onClick={() => choose('changes_requested')}
      >
        Request changes
      </Button>
      <Button variant="destructive" size="xs" disabled={pending} onClick={() => choose('blocked')}>
        Block
      </Button>
    </div>
  )
}
