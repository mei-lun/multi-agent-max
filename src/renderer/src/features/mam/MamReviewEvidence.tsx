import { AlertTriangle, FileDiff, GitCommit } from 'lucide-react'
import { useEffect, useState } from 'react'
import type {
  MamAttemptDiff,
  MamGetAttemptDiffInput
} from '../../../../shared/mam/attempt-inspection'
import type { ReviewSubject } from '../../../../shared/mam/domain/review'
import type { MamUiRunSnapshot } from '../../../../shared/mam/ui-projection'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { MamStateBadge } from './MamStateBadge'
import { MamTaskContractList } from './MamAttemptPanel'

export function MamReviewEvidence({
  run,
  subject,
  onGetAttemptDiff
}: Readonly<{
  run: MamUiRunSnapshot
  subject: ReviewSubject
  onGetAttemptDiff(input: MamGetAttemptDiffInput): Promise<MamAttemptDiff>
}>): React.JSX.Element {
  const task = run.tasks.find((candidate) => candidate.id === subject.taskId)
  const attempt = run.attempts.find((candidate) => candidate.id === subject.attemptId)
  const [diff, setDiff] = useState<MamAttemptDiff>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(Boolean(subject.submittedCommit))

  useEffect(() => {
    let active = true
    setDiff(undefined)
    setError(undefined)
    if (!subject.submittedCommit) {
      setLoading(false)
      return () => {
        active = false
      }
    }
    setLoading(true)
    void onGetAttemptDiff({ workflowRunId: run.run.id, attemptId: subject.attemptId })
      .then((value) => {
        if (active) setDiff(value)
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [onGetAttemptDiff, run.run.id, subject.attemptId, subject.submittedCommit])

  const retry = async (): Promise<void> => {
    setLoading(true)
    setError(undefined)
    try {
      setDiff(await onGetAttemptDiff({ workflowRunId: run.run.id, attemptId: subject.attemptId }))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-background p-4">
      <div>
        <p className="text-xs font-medium text-muted-foreground">Work to review</p>
        <p className="mt-1 text-sm font-medium">{task?.title ?? subject.taskId}</p>
      </div>
      {attempt?.result ? (
        <ResultEvidence result={attempt.result} />
      ) : (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 p-3 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          <p>
            The submitted result details are unavailable. You can still inspect its Git changes.
          </p>
        </div>
      )}
      <div className="space-y-2 border-t border-border pt-3">
        <p className="flex items-center gap-1.5 text-xs font-medium">
          <FileDiff className="size-3.5" /> Git changes
        </p>
        {subject.submittedCommit ? (
          <>
            <p className="flex items-center gap-1.5 break-all font-mono text-xs text-muted-foreground">
              <GitCommit className="size-3.5 shrink-0" /> {subject.submittedCommit}
            </p>
            {loading && <p className="text-xs text-muted-foreground">Loading diff…</p>}
            {error && (
              <div className="space-y-2" role="alert">
                <p className="text-xs text-destructive">Git diff could not be loaded: {error}</p>
                <Button variant="outline" size="xs" onClick={() => void retry()}>
                  Retry loading diff
                </Button>
              </div>
            )}
            {diff && <DiffContents diff={diff} />}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">This result has no Git commit to review.</p>
        )}
      </div>
      <details className="border-t border-border pt-3 text-xs text-muted-foreground">
        <summary className="w-fit cursor-pointer hover:text-foreground">Technical details</summary>
        <p className="mt-2 break-all font-mono">Subject Attempt {subject.attemptId}</p>
      </details>
    </div>
  )
}

function ResultEvidence({
  result
}: Readonly<{
  result: NonNullable<MamUiRunSnapshot['attempts'][number]['result']>
}>): React.JSX.Element {
  return (
    <div className="space-y-3 text-xs">
      <div>
        <p className="font-medium text-muted-foreground">Result summary</p>
        <p className="mt-1 whitespace-pre-wrap text-sm">{result.summary}</p>
      </div>
      <MamTaskContractList
        label="Artifacts"
        values={result.artifacts.map((artifact) => `${artifact.type} · ${artifact.contentRef}`)}
      />
      <MamTaskContractList label="Risks" values={result.risks} />
      <MamTaskContractList label="Follow-ups" values={result.followUps} />
      {result.verifications.length > 0 && (
        <div className="space-y-1">
          <p className="font-medium text-muted-foreground">Verification</p>
          {result.verifications.map((verification, index) => (
            <div
              key={`${verification.command}:${index}`}
              className="flex items-start justify-between gap-3"
            >
              <code className="min-w-0 break-all">{verification.command}</code>
              <MamStateBadge status={verification.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DiffContents({ diff }: Readonly<{ diff: MamAttemptDiff }>): React.JSX.Element {
  return (
    <div className="space-y-1">
      {diff.truncated && <Badge variant="outline">truncated at 2 MiB</Badge>}
      <pre className="scrollbar-editor max-h-96 overflow-auto rounded-md border border-border bg-editor-surface p-3 font-mono text-xs whitespace-pre-wrap">
        {diff.diff || 'This Attempt commit has no file changes.'}
      </pre>
    </div>
  )
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
