import { AlertTriangle, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type {
  MamCancelWorkflowRunInput,
  MamRestartWorkflowRunInput
} from '../../../../shared/mam/application-command'
import type { MamUiRunSnapshot } from '../../../../shared/mam/ui-projection'
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

export function MamResetRunDialog({
  run,
  pending,
  onCancel,
  onRestart
}: Readonly<{
  run: MamUiRunSnapshot
  pending: boolean
  onCancel(input: MamCancelWorkflowRunInput): Promise<void>
  onRestart(input: MamRestartWorkflowRunInput): Promise<void>
}>): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState<'cancel' | 'restart'>()
  const [error, setError] = useState<string>()
  const activeAttempts = run.attempts.filter(
    (attempt) => attempt.status === 'announced' || attempt.status === 'running'
  )
  const submit = async (action: 'cancel' | 'restart'): Promise<void> => {
    setSubmitting(action)
    setError(undefined)
    try {
      const input = { workflowRunId: run.run.id }
      await (action === 'restart' ? onRestart(input) : onCancel(input))
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSubmitting(undefined)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) setError(undefined)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="xs" disabled={pending}>
          <RotateCcw /> Clear or restart
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clear this active Run?</DialogTitle>
          <DialogDescription>
            The Run will leave current work and move to Cancelled history. Git events and completed
            Attempt evidence remain immutable.
          </DialogDescription>
        </DialogHeader>
        {activeAttempts.length > 0 && (
          <div className="flex gap-2 rounded-lg border border-destructive p-3 text-xs text-destructive">
            <AlertTriangle className="size-4 shrink-0" />
            {activeAttempts.length} local Roles are still working. Close this dialog and choose
            Pause to prevent new Tasks; clear the Run after the current Roles finish.
          </div>
        )}
        <div className="space-y-1 rounded-lg border border-border bg-muted/30 p-3 text-xs">
          <p className="font-medium">Start over</p>
          <p className="text-muted-foreground">
            “Clear and restart” creates a fresh Run from the same Workflow version and external
            inputs, using currently active Role versions.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={Boolean(submitting)}>
              Back
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={pending || Boolean(submitting) || activeAttempts.length > 0}
            onClick={() => void submit('cancel')}
          >
            {submitting === 'cancel' ? <Loader2 className="animate-spin" /> : <Trash2 />}
            Clear Run
          </Button>
          <Button
            disabled={pending || Boolean(submitting) || activeAttempts.length > 0}
            onClick={() => void submit('restart')}
          >
            {submitting === 'restart' ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            Clear and restart
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
