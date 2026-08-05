import { AlertTriangle, Loader2, Play } from 'lucide-react'
import { useState } from 'react'
import type { MamStartAttemptInput } from '../../../../shared/mam/application-command'
import { Button } from '../../components/ui/button'
import { translateUiText, useUiLocale } from '../../i18n/ui-locale'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '../../components/ui/dialog'

export function MamStartAttemptDialog({
  input,
  activeAttemptIds,
  pending,
  onStart
}: Readonly<{
  input: MamStartAttemptInput
  activeAttemptIds: readonly string[]
  pending: boolean
  onStart(input: MamStartAttemptInput): Promise<void>
}>): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string>()
  const { locale } = useUiLocale()
  const start = async (): Promise<void> => {
    setError(undefined)
    try {
      await onStart(input)
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={pending}>
          <Play /> Run Task
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Run this Task?</DialogTitle>
          <DialogDescription>
            Preflight the fixed Workflow Role, freeze its Effective Config, and create an isolated
            task branch and worktree.
          </DialogDescription>
        </DialogHeader>
        {activeAttemptIds.length > 0 ? (
          <div className="flex gap-2 rounded-lg border border-destructive p-3 text-xs text-destructive">
            <AlertTriangle className="size-4 shrink-0" />
            <span>
              {translateUiText(
                `${activeAttemptIds.length} Attempt${activeAttemptIds.length === 1 ? '' : 's'} already appear active. Starting remains allowed and records a concurrent execution warning.`,
                locale
              )}
            </span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Missing local executors, credentials, or required resources stop before any Attempt
            state is written.
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={pending} aria-busy={pending} onClick={() => void start()}>
            {pending ? <Loader2 className="animate-spin" /> : <Play />}
            {pending ? 'Starting Task…' : 'Run Task'}
          </Button>
        </DialogFooter>
        {pending && (
          <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
            Preparing the Task and worktree…
          </p>
        )}
        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
