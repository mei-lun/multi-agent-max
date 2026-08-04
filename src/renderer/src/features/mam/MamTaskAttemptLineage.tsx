import { History } from 'lucide-react'
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
import { MamAttemptPanel } from './MamAttemptPanel'

type Attempt = MamUiRunSnapshot['attempts'][number]

export function MamTaskAttemptLineage({
  attempts,
  selectedAttemptId,
  workflowRunId,
  pending,
  onRecoverAttempt,
  onSelectAttempt,
  onGetAttemptDiff
}: Readonly<{
  attempts: readonly Attempt[]
  selectedAttemptId?: string
  workflowRunId: string
  pending: boolean
  onRecoverAttempt(input: MamRecoverAttemptInput): Promise<void>
  onSelectAttempt(input: MamSelectAttemptInput): Promise<void>
  onGetAttemptDiff(input: MamGetAttemptDiffInput): Promise<MamAttemptDiff>
}>): React.JSX.Element {
  const latest = attempts.at(-1)
  const previous = attempts.slice(0, -1).reverse()
  const selectedHistory = previous.some((attempt) => selectedAttemptId === attempt.id)
  const [historyOpen, setHistoryOpen] = useState(selectedHistory)
  if (!latest) return <p className="text-xs text-muted-foreground">No Attempts recorded.</p>
  return (
    <div className="space-y-3">
      <MamAttemptPanel
        workflowRunId={workflowRunId}
        attempt={latest}
        selected={selectedAttemptId === latest.id}
        latest
        pending={pending}
        onRecoverAttempt={onRecoverAttempt}
        onSelectAttempt={onSelectAttempt}
        onGetAttemptDiff={onGetAttemptDiff}
      />
      {previous.length > 0 && (
        <details
          className="group/history rounded-lg border border-border"
          open={selectedHistory || historyOpen}
          onToggle={(event) => {
            if (!selectedHistory) setHistoryOpen(event.currentTarget.open)
          }}
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
            <History className="size-3.5 text-muted-foreground" />
            <span>Earlier Attempts</span>
            <Badge className="ml-auto" variant="outline">
              {previous.length}
            </Badge>
          </summary>
          <ol className="space-y-3 border-t border-border bg-muted/20 p-3">
            {previous.map((attempt) => (
              <li key={attempt.id}>
                <MamAttemptPanel
                  workflowRunId={workflowRunId}
                  attempt={attempt}
                  selected={selectedAttemptId === attempt.id}
                  latest={false}
                  pending={pending}
                  onRecoverAttempt={onRecoverAttempt}
                  onSelectAttempt={onSelectAttempt}
                  onGetAttemptDiff={onGetAttemptDiff}
                />
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  )
}
