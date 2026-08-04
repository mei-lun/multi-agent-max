import { useState } from 'react'
import type { MamRecoverAttemptInput } from '../../../../shared/mam/application-command'
import { Button } from '../../components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '../../components/ui/dialog'

export function MamAttemptRecoveryDialog({
  workflowRunId,
  taskId,
  attemptId,
  attemptStatus,
  interruptionStage,
  pending,
  onRecoverAttempt
}: Readonly<{
  workflowRunId: string
  taskId: string
  attemptId: string
  attemptStatus: 'announced' | 'running' | 'needs_reconciliation'
  interruptionStage?: 'result_validation' | 'artifact_validation' | 'executor'
  pending: boolean
  onRecoverAttempt(input: MamRecoverAttemptInput): Promise<void>
}>): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string>()
  const reconciling = attemptStatus === 'needs_reconciliation'
  const safeResultFailure =
    reconciling && Boolean(interruptionStage && interruptionStage !== 'executor')
  const recover = async (
    resolution: MamRecoverAttemptInput['resolution'],
    reason: string
  ): Promise<void> => {
    setError(undefined)
    try {
      await onRecoverAttempt({
        workflowRunId,
        taskId,
        previousAttemptId: attemptId,
        resolution,
        reason
      })
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) {
          setError(undefined)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="xs">
          {safeResultFailure
            ? 'Retry this Task'
            : reconciling
              ? 'Confirm before retry'
              : 'Recover interrupted Attempt'}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {safeResultFailure
              ? 'Retry this Task?'
              : reconciling
                ? 'Is it safe to retry this Task?'
                : 'Recover interrupted Attempt?'}
          </DialogTitle>
          <DialogDescription>
            {safeResultFailure
              ? 'The Role finished, but MAM could not accept a complete result after automatic retries. You do not need to inspect internal data formats.'
              : reconciling
                ? 'Confirm whether the Role changed anything outside its isolated workspace. Retry only when that external state is safe.'
                : 'Choose based on whether the Executor may have changed external state before it stopped. The original Attempt remains in history.'}
          </DialogDescription>
        </DialogHeader>
        {!reconciling && (
          <div className="space-y-3 text-xs">
            <div className="rounded-lg border border-border p-3">
              <p className="font-medium">Require reconciliation</p>
              <p className="mt-1 text-muted-foreground">
                Mark the Task as needing attention when an external side effect may be unknown.
              </p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="font-medium">Create a replacement</p>
              <p className="mt-1 text-muted-foreground">
                Block this Attempt and plan a replacement only when replay is safe.
              </p>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" size="sm" disabled={pending}>
              {reconciling ? 'Keep paused' : 'Cancel'}
            </Button>
          </DialogClose>
          {reconciling ? (
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                void recover(
                  'start_new_attempt',
                  safeResultFailure
                    ? 'The user requested another result attempt after automatic validation retries were exhausted.'
                    : 'The user confirmed that external state is safe for replay.'
                )
              }
            >
              {safeResultFailure ? 'Retry now' : 'I checked — retry safely'}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() =>
                  void recover(
                    'start_new_attempt',
                    'The user confirmed that replay is safe after the Executor interruption.'
                  )
                }
              >
                Create replacement Attempt
              </Button>
              <Button
                size="sm"
                disabled={pending}
                onClick={() =>
                  void recover(
                    'needs_reconciliation',
                    'The interrupted Attempt may have an unknown external side effect.'
                  )
                }
              >
                Require reconciliation
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
