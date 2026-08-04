import { MessagesSquare, ShieldCheck } from 'lucide-react'
import type {
  MamResolveReviewDisagreementInput,
  MamSubmitReviewInput
} from '../../../../shared/mam/application-command'
import type {
  MamAttemptDiff,
  MamGetAttemptDiffInput
} from '../../../../shared/mam/attempt-inspection'
import type { MamUiRunSnapshot } from '../../../../shared/mam/ui-projection'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { useUiLocale, type UiLocale } from '../../i18n/ui-locale'
import { MamStateBadge } from './MamStateBadge'
import { MamOpenReviewsSection, type MamOpenReviewItem } from './MamOpenReviewsSection'
import {
  MamReviewAggregationSection,
  type MamReviewAggregationItem
} from './MamReviewAggregationSection'

type ReviewItem = Readonly<{
  run: MamUiRunSnapshot
  decision: MamUiRunSnapshot['reviews'][number]
}>

export function MamReviewsPage({
  runs,
  pending,
  onSubmitReview,
  onResolveDisagreement,
  onGetAttemptDiff,
  onOpenIntegration
}: Readonly<{
  runs: readonly MamUiRunSnapshot[]
  pending: boolean
  onSubmitReview(input: MamSubmitReviewInput): Promise<void>
  onResolveDisagreement(input: MamResolveReviewDisagreementInput): Promise<void>
  onGetAttemptDiff(input: MamGetAttemptDiffInput): Promise<MamAttemptDiff>
  onOpenIntegration?(workflowRunId: string): void
}>): React.JSX.Element {
  const { locale } = useUiLocale()
  const openReviews = collectOpenReviews(runs)
  const decisions: ReviewItem[] = runs
    .flatMap((run) => run.reviews.map((decision) => ({ run, decision })))
    .sort((left, right) => right.decision.createdAt.localeCompare(left.decision.createdAt))
  const aggregations: MamReviewAggregationItem[] = runs
    .flatMap((run) => run.reviewAggregations.map((aggregation) => ({ run, aggregation })))
    .sort((left, right) => right.aggregation.createdAt.localeCompare(left.aggregation.createdAt))
  return (
    <section aria-labelledby="reviews-title" className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <div className="space-y-1">
        <h1 id="reviews-title" className="text-xl font-semibold">
          Reviews
        </h1>
        <p className="text-sm text-muted-foreground">
          Immutable decisions, findings, and deterministic panel aggregation.
        </p>
      </div>

      {openReviews.length === 0 && decisions.length === 0 && aggregations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <MessagesSquare className="mx-auto mb-3 size-7 text-muted-foreground" />
          <p className="text-sm font-medium">No Review decisions</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Decisions appear after reviewer Attempts submit valid Review Artifacts.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {openReviews.length > 0 && (
            <MamOpenReviewsSection
              items={openReviews}
              pending={pending}
              onSubmit={onSubmitReview}
              onGetAttemptDiff={onGetAttemptDiff}
            />
          )}
          {aggregations.length > 0 && (
            <MamReviewAggregationSection
              items={aggregations}
              pending={pending}
              onResolve={onResolveDisagreement}
              onGetAttemptDiff={onGetAttemptDiff}
            />
          )}
          {decisions.length > 0 && (
            <DecisionSection
              items={decisions}
              locale={locale}
              {...(onOpenIntegration ? { onOpenIntegration } : {})}
            />
          )}
        </div>
      )}
    </section>
  )
}

function collectOpenReviews(runs: readonly MamUiRunSnapshot[]): MamOpenReviewItem[] {
  return runs.flatMap((run) =>
    run.tasks.flatMap((task) => {
      if (task.kind !== 'review') return []
      const attempt = [...run.attempts]
        .reverse()
        .find((candidate) => candidate.taskId === task.id && candidate.status === 'running')
      return attempt ? [{ run, task, attempt }] : []
    })
  )
}

function DecisionSection({
  items,
  locale,
  onOpenIntegration
}: Readonly<{
  items: readonly ReviewItem[]
  locale: UiLocale
  onOpenIntegration?(workflowRunId: string): void
}>) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Decisions</h2>
        <span className="text-xs text-muted-foreground">{items.length} total</span>
      </div>
      <div className="space-y-3">
        {items.map(({ run, decision }) => (
          <article key={decision.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{run.definitionName}</p>
                <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                  {decision.id}
                </p>
              </div>
              <MamStateBadge status={decision.status} />
            </div>
            <p className="mt-3 text-sm">{decision.summary}</p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="size-3.5" /> Reviewer Attempt {decision.reviewerAttemptId}
              </span>
              <span>Subject Attempt {decision.attemptId}</span>
              <span>{formatTimestamp(decision.createdAt, locale)}</span>
            </div>
            <ReviewIntegrationStatus
              run={run}
              decision={decision}
              {...(onOpenIntegration ? { onOpenIntegration } : {})}
            />
            {decision.findings.length > 0 && (
              <div className="mt-4 space-y-2 border-t border-border pt-3">
                {decision.findings.map((finding) => (
                  <div key={finding.id} className="flex items-start gap-3 text-xs">
                    <FindingSeverity severity={finding.severity} />
                    <div className="min-w-0">
                      <p>{finding.summary}</p>
                      {(finding.filePath || finding.line) && (
                        <p className="mt-1 break-all font-mono text-muted-foreground">
                          {finding.filePath ?? 'Unknown file'}
                          {finding.line ? `:${finding.line}` : ''}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  )
}

function ReviewIntegrationStatus({
  run,
  decision,
  onOpenIntegration
}: Readonly<{
  run: MamUiRunSnapshot
  decision: MamUiRunSnapshot['reviews'][number]
  onOpenIntegration?(workflowRunId: string): void
}>): React.JSX.Element | null {
  if (decision.status !== 'approved') return null
  const entry = run.mergeQueueEntries.find((candidate) =>
    candidate.reviewDecisionIds.includes(decision.id)
  )
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
      <p className="text-xs text-muted-foreground">
        {entry
          ? `This decision released commit ${entry.submittedCommit} to the ${entry.targetBranch} integration stage.`
          : 'Approved. The Run advances when its remaining Workflow prerequisites are satisfied.'}
      </p>
      {entry && onOpenIntegration && (
        <Button variant="outline" size="xs" onClick={() => onOpenIntegration(run.run.id)}>
          View integration activity
        </Button>
      )}
    </div>
  )
}

function FindingSeverity({
  severity
}: Readonly<{
  severity: MamUiRunSnapshot['reviews'][number]['findings'][number]['severity']
}>): React.JSX.Element {
  return (
    <Badge variant={severity === 'blocker' || severity === 'high' ? 'destructive' : 'outline'}>
      {severity}
    </Badge>
  )
}

function formatTimestamp(value: string, locale: UiLocale): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}
