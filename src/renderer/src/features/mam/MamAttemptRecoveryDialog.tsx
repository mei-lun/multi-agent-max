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
  pending,
  onRecoverAttempt
}: Readonly<{
  workflowRunId: string
  taskId: string
  attemptId: string
  pending: boolean
  onRecoverAttempt(input: MamRecoverAttemptInput): Promise<void>
}>): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const recover = async (
    resolution: MamRecoverAttemptInput['resolution'],
    reason: string
  ): Promise<void> => {
    await onRecoverAttempt({
      workflowRunId,
      taskId,
      previousAttemptId: attemptId,
      resolution,
      reason
    })
    setOpen(false)
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="xs">
          Recover interrupted Attempt
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Recover interrupted Attempt?</DialogTitle>
          <DialogDescription>
            Choose based on whether the Executor may have changed external state before it stopped.
            The original Attempt remains in history.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-xs">
          <div className="rounded-lg border border-border p-3">
            <p className="font-medium">Require reconciliation</p>
            <p className="mt-1 text-muted-foreground">
              Mark the Task as needing attention when an external side effect may be unknown.
            </p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="font-medium">Start a replacement</p>
            <p className="mt-1 text-muted-foreground">
              Block this Attempt and create a new recovery-planned Attempt only when replay is safe.
            </p>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" size="sm" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
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
            Start replacement
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
