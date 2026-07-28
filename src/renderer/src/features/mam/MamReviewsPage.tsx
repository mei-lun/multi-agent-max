import { AlertTriangle, MessagesSquare, ShieldCheck } from 'lucide-react'
import type {
  MamResolveReviewDisagreementInput,
  MamSubmitReviewInput
} from '../../../../shared/mam/application-command'
import type { MamUiRunSnapshot } from '../../../../shared/mam/ui-projection'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { useUiLocale, type UiLocale } from '../../i18n/ui-locale'
import { MamStateBadge } from './MamStateBadge'
import { MamReviewSubmissionDialog } from './MamReviewSubmissionDialog'

type ReviewItem = Readonly<{
  run: MamUiRunSnapshot
  decision: MamUiRunSnapshot['reviews'][number]
}>

type AggregationItem = Readonly<{
  run: MamUiRunSnapshot
  aggregation: MamUiRunSnapshot['reviewAggregations'][number]
}>

type OpenReviewItem = Readonly<{
  run: MamUiRunSnapshot
  task: MamUiRunSnapshot['tasks'][number]
  attempt: MamUiRunSnapshot['attempts'][number]
}>

export function MamReviewsPage({
  runs,
  pending,
  onSubmitReview,
  onResolveDisagreement
}: Readonly<{
  runs: readonly MamUiRunSnapshot[]
  pending: boolean
  onSubmitReview(input: MamSubmitReviewInput): Promise<void>
  onResolveDisagreement(input: MamResolveReviewDisagreementInput): Promise<void>
}>): React.JSX.Element {
  const { locale } = useUiLocale()
  const openReviews = collectOpenReviews(runs)
  const decisions: ReviewItem[] = runs
    .flatMap((run) => run.reviews.map((decision) => ({ run, decision })))
    .sort((left, right) => right.decision.createdAt.localeCompare(left.decision.createdAt))
  const aggregations: AggregationItem[] = runs
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
            <OpenReviewSection items={openReviews} pending={pending} onSubmit={onSubmitReview} />
          )}
          {aggregations.length > 0 && (
            <AggregationSection
              items={aggregations}
              pending={pending}
              onResolve={onResolveDisagreement}
            />
          )}
          {decisions.length > 0 && <DecisionSection items={decisions} locale={locale} />}
        </div>
      )}
    </section>
  )
}

function OpenReviewSection({
  items,
  pending,
  onSubmit
}: Readonly<{
  items: readonly OpenReviewItem[]
  pending: boolean
  onSubmit(input: MamSubmitReviewInput): Promise<void>
}>): React.JSX.Element {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold">Ready to submit</h2>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {items.map(({ run, task, attempt }) => (
          <div
            key={attempt.id}
            className="flex items-center justify-between gap-4 border-b border-border p-4 last:border-b-0"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{task.title}</p>
              <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                {run.definitionName} · {attempt.id}
              </p>
            </div>
            <MamReviewSubmissionDialog
              workflowRunId={run.run.id}
              task={task}
              attempt={attempt}
              pending={pending}
              onSubmit={onSubmit}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function AggregationSection({
  items,
  pending,
  onResolve
}: Readonly<{
  items: readonly AggregationItem[]
  pending: boolean
  onResolve(input: MamResolveReviewDisagreementInput): Promise<void>
}>): React.JSX.Element {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Panel outcomes</h2>
        <span className="text-xs text-muted-foreground">{items.length} total</span>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {items.map(({ run, aggregation }) => {
          const resolution = run.reviewDisagreementResolutions.find(
            (candidate) => candidate.aggregationId === aggregation.id
          )
          return (
            <div key={aggregation.id} className="border-b border-border p-4 last:border-b-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{run.definitionName}</p>
                  <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {aggregation.id}
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
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{aggregation.classification.replaceAll('_', ' ')}</span>
                <span>{aggregation.sourceDecisionIds.length} decisions</span>
                <span>{aggregation.findings.length} findings</span>
                <span className="font-mono">Attempt {aggregation.attemptId}</span>
              </div>
              {resolution ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Resolved as{' '}
                  <span className="font-medium text-foreground">
                    {resolution.selectedOption.replaceAll('_', ' ')}
                  </span>{' '}
                  by {resolution.userId}.
                </p>
              ) : aggregation.requiresHumanDecision ? (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                  <Button
                    size="xs"
                    disabled={pending}
                    onClick={() =>
                      void onResolve({
                        workflowRunId: run.run.id,
                        aggregationId: aggregation.id,
                        selectedStatus: 'approved'
                      })
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={pending}
                    onClick={() =>
                      void onResolve({
                        workflowRunId: run.run.id,
                        aggregationId: aggregation.id,
                        selectedStatus: 'changes_requested'
                      })
                    }
                  >
                    Request changes
                  </Button>
                  <Button
                    variant="destructive"
                    size="xs"
                    disabled={pending}
                    onClick={() =>
                      void onResolve({
                        workflowRunId: run.run.id,
                        aggregationId: aggregation.id,
                        selectedStatus: 'blocked'
                      })
                    }
                  >
                    Block
                  </Button>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function collectOpenReviews(runs: readonly MamUiRunSnapshot[]): OpenReviewItem[] {
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
  locale
}: Readonly<{ items: readonly ReviewItem[]; locale: UiLocale }>) {
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
