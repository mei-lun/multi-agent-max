import { FileDiff, GitCommit } from 'lucide-react'
import { useState } from 'react'
import type {
  MamRecoverAttemptInput,
  MamSelectAttemptInput
} from '../../../../shared/mam/application-command'
import type {
  MamAttemptDiff,
  MamGetAttemptDiffInput
} from '../../../../shared/mam/attempt-inspection'
import type { MamUiRunSnapshot } from '../../../../shared/mam/ui-projection'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { MamAttemptRecoveryDialog } from './MamAttemptRecoveryDialog'
import { MamStateBadge } from './MamStateBadge'

export function MamAttemptPanel({
  attempt,
  selected,
  latest,
  workflowRunId,
  pending,
  onRecoverAttempt,
  onSelectAttempt,
  onGetAttemptDiff
}: Readonly<{
  attempt: MamUiRunSnapshot['attempts'][number]
  selected: boolean
  latest: boolean
  workflowRunId: string
  pending: boolean
  onRecoverAttempt(input: MamRecoverAttemptInput): Promise<void>
  onSelectAttempt(input: MamSelectAttemptInput): Promise<void>
  onGetAttemptDiff(input: MamGetAttemptDiffInput): Promise<MamAttemptDiff>
}>): React.JSX.Element {
  const [diff, setDiff] = useState<MamAttemptDiff>()
  const [diffError, setDiffError] = useState<string>()
  const [loadingDiff, setLoadingDiff] = useState(false)
  const loadDiff = async (): Promise<void> => {
    setLoadingDiff(true)
    setDiffError(undefined)
    try {
      setDiff(await onGetAttemptDiff({ workflowRunId, attemptId: attempt.id }))
    } catch (error) {
      setDiffError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoadingDiff(false)
    }
  }
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-xs">{attempt.id}</span>
          {selected && <Badge variant="outline">selected</Badge>}
          {latest && <Badge variant="secondary">latest</Badge>}
        </div>
        <MamStateBadge status={attempt.status} />
      </div>
      {!latest && (
        <div className="mt-3 border-t border-border pt-3">
          <Button
            variant="outline"
            size="xs"
            disabled={pending || selected}
            onClick={() =>
              void onSelectAttempt({
                workflowRunId,
                taskId: attempt.taskId,
                attemptId: attempt.id
              })
            }
          >
            {selected ? 'Opened read-only' : 'Open historical read-only'}
          </Button>
        </div>
      )}
      {(attempt.status === 'announced' || attempt.status === 'running') && (
        <div className="mt-3 border-t border-border pt-3">
          <MamAttemptRecoveryDialog
            workflowRunId={workflowRunId}
            taskId={attempt.taskId}
            attemptId={attempt.id}
            pending={pending}
            onRecoverAttempt={onRecoverAttempt}
          />
        </div>
      )}
      {attempt.previousAttemptId && (
        <p className="mt-2 text-xs text-muted-foreground">
          Continues <span className="font-mono">{attempt.previousAttemptId}</span>
        </p>
      )}
      {attempt.result && (
        <div className="mt-3 space-y-3 border-t border-border pt-3 text-xs">
          <p>{attempt.result.summary}</p>
          {attempt.result.system.submittedCommit && (
            <AttemptDiff
              commit={attempt.result.system.submittedCommit}
              {...(diff ? { diff } : {})}
              {...(diffError ? { error: diffError } : {})}
              loading={loadingDiff}
              onLoad={() => void loadDiff()}
            />
          )}
          {attempt.result.artifacts.length > 0 && (
            <MamTaskContractList
              label="Artifacts"
              values={attempt.result.artifacts.map(
                (artifact) => `${artifact.type} · ${artifact.sha256.slice(0, 12)}`
              )}
            />
          )}
          <MamTaskContractList label="Risks" values={attempt.result.risks} />
          <MamTaskContractList label="Follow-ups" values={attempt.result.followUps} />
          {attempt.result.verifications.length > 0 && (
            <div className="space-y-1">
              {attempt.result.verifications.map((verification, index) => (
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
      )}
    </div>
  )
}

function AttemptDiff({
  commit,
  diff,
  error,
  loading,
  onLoad
}: Readonly<{
  commit: string
  diff?: MamAttemptDiff
  error?: string
  loading: boolean
  onLoad(): void
}>): React.JSX.Element {
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 font-mono text-muted-foreground">
        <GitCommit className="size-3.5" /> {commit}
      </p>
      <Button variant="outline" size="xs" disabled={loading} onClick={onLoad}>
        <FileDiff /> {loading ? 'Loading diff…' : 'Load Git diff'}
      </Button>
      {error && <p className="text-destructive">{error}</p>}
      {diff && (
        <div className="space-y-1">
          {diff.truncated && <Badge variant="outline">truncated at 2 MiB</Badge>}
          <pre className="scrollbar-editor max-h-80 overflow-auto rounded-md border border-border bg-editor-surface p-3 font-mono text-xs whitespace-pre-wrap">
            {diff.diff || 'This Attempt commit has no file changes.'}
          </pre>
        </div>
      )}
    </div>
  )
}

export function MamTaskContractList({
  label,
  values
}: Readonly<{ label: string; values: readonly string[] }>): React.JSX.Element {
  return (
    <div>
      <p className="font-medium text-muted-foreground">{label}</p>
      {values.length === 0 ? (
        <p className="mt-1 text-muted-foreground">None</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {values.map((value, index) => (
            <li key={`${value}:${index}`} className="break-all">
              {value}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
