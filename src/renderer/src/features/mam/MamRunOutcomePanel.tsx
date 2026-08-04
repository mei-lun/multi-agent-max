import { CheckCircle2, CircleAlert, GitMerge } from 'lucide-react'
import type { MamUiRunSnapshot } from '../../../../shared/mam/ui-projection'
import { Badge } from '../../components/ui/badge'

export function MamRunOutcomePanel({
  run
}: Readonly<{ run: MamUiRunSnapshot }>): React.JSX.Element | null {
  const merged = [...run.mergeQueueEntries].filter((entry) => entry.status === 'merged').reverse()
  const mainMerge = merged.find((entry) => entry.targetBranch === 'main')
  const developMerge = merged.find((entry) => entry.targetBranch === 'develop')
  if (run.run.status !== 'completed' && !developMerge && !mainMerge) return null
  const attempt = finalProductAttempt(run)
  const codeCommit = attempt?.result?.system.submittedCommit
  if (!attempt?.result && merged.length === 0) return null
  const delivered = !codeCommit || Boolean(mainMerge)
  const title = mainMerge
    ? 'Final version is ready on main'
    : developMerge
      ? 'Integrated result is ready on develop'
      : codeCommit
        ? 'Result is reviewed but not delivered'
        : 'Final result is ready'
  const StatusIcon = delivered ? CheckCircle2 : CircleAlert
  return (
    <section
      className={`space-y-2 border-b border-border px-4 py-4 text-xs ${delivered ? 'bg-[var(--status-success-background)]' : 'bg-muted/30'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          className={`flex items-center gap-2 text-sm font-semibold ${delivered ? 'text-[var(--status-success)]' : 'text-foreground'}`}
        >
          <StatusIcon className="size-4" /> {title}
        </h3>
        {mainMerge && <Badge variant="outline">Delivered to main</Badge>}
        {!mainMerge && developMerge && <Badge variant="outline">Available on develop</Badge>}
      </div>
      {attempt?.result?.summary && <p className="leading-5">{attempt.result.summary}</p>}
      {codeCommit && !developMerge && !mainMerge && (
        <p className="text-muted-foreground">
          The accepted code is still on its task branch. This Workflow ended without a Git merge
          delivery stage, so it is not yet deployable from develop or main.
        </p>
      )}
      {developMerge && !mainMerge && (
        <p className="text-muted-foreground">
          Use develop for the runnable demonstration. Final user acceptance must promote this
          integrated revision to main.
        </p>
      )}
      {attempt?.result && attempt.result.artifacts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attempt.result.artifacts.map((artifact) => (
            <Badge key={`${artifact.type}:${artifact.sha256}`} variant="secondary">
              {artifact.type}
            </Badge>
          ))}
        </div>
      )}
      {mainMerge && (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <GitMerge className="size-3.5" /> The accepted integrated revision is now on main.
        </p>
      )}
      <details className="text-muted-foreground">
        <summary className="w-fit cursor-pointer hover:text-foreground">Technical details</summary>
        {attempt?.result?.system.submittedCommit && (
          <p className="mt-2 break-all font-mono">
            Result commit: {attempt.result.system.submittedCommit}
          </p>
        )}
        {developMerge?.mergeCommit && (
          <p className="mt-1 break-all font-mono">
            Develop merge commit: {developMerge.mergeCommit}
          </p>
        )}
        {mainMerge?.mergeCommit && (
          <p className="mt-1 break-all font-mono">Main merge commit: {mainMerge.mergeCommit}</p>
        )}
      </details>
    </section>
  )
}

export function finalProductAttempt(run: MamUiRunSnapshot) {
  const productTasks = run.tasks.filter((task) => task.kind !== 'review')
  for (const task of [...productTasks].reverse()) {
    const attemptIds = task.selectedAttemptId
      ? [task.selectedAttemptId, ...[...task.attemptIds].reverse()]
      : [...task.attemptIds].reverse()
    const attempt = attemptIds
      .map((attemptId) => run.attempts.find((candidate) => candidate.id === attemptId))
      .find((candidate) => candidate?.result)
    if (attempt) return attempt
  }
  return [...run.attempts].reverse().find((attempt) => attempt.result)
}
