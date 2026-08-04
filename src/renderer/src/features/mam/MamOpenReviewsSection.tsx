import type { MamSubmitReviewInput } from '../../../../shared/mam/application-command'
import type {
  MamAttemptDiff,
  MamGetAttemptDiffInput
} from '../../../../shared/mam/attempt-inspection'
import type { MamUiRunSnapshot } from '../../../../shared/mam/ui-projection'
import { MamReviewEvidence } from './MamReviewEvidence'
import { MamReviewSubmissionDialog } from './MamReviewSubmissionDialog'

export type MamOpenReviewItem = Readonly<{
  run: MamUiRunSnapshot
  task: MamUiRunSnapshot['tasks'][number]
  attempt: MamUiRunSnapshot['attempts'][number]
}>

export function MamOpenReviewsSection({
  items,
  pending,
  onSubmit,
  onGetAttemptDiff
}: Readonly<{
  items: readonly MamOpenReviewItem[]
  pending: boolean
  onSubmit(input: MamSubmitReviewInput): Promise<void>
  onGetAttemptDiff(input: MamGetAttemptDiffInput): Promise<MamAttemptDiff>
}>): React.JSX.Element {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Review required</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Inspect the submitted result and Git changes before recording your decision.
        </p>
      </div>
      <div className="space-y-3">
        {items.map(({ run, task, attempt }) => (
          <article
            key={attempt.id}
            className="space-y-4 rounded-xl border border-border bg-card p-4"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{task.title}</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{run.definitionName}</p>
            </div>
            {task.reviewSubject ? (
              <MamReviewEvidence
                run={run}
                subject={task.reviewSubject}
                onGetAttemptDiff={onGetAttemptDiff}
              />
            ) : (
              <p className="rounded-md border border-destructive/40 p-3 text-xs text-destructive">
                The work to review is unavailable. Do not submit a decision yet.
              </p>
            )}
            <div className="flex justify-end border-t border-border pt-3">
              <MamReviewSubmissionDialog
                workflowRunId={run.run.id}
                task={task}
                attempt={attempt}
                pending={pending || !task.reviewSubject}
                onSubmit={onSubmit}
              />
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
