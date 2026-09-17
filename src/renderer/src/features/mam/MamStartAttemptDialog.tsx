import { Loader2, Play } from 'lucide-react'
import { useState } from 'react'
import type { MamStartAttemptInput } from '../../../../shared/mam/application-command'
import type { TaskClaim } from '../../../../shared/mam/domain/task-claim'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import { Textarea } from '../../components/ui/textarea'
import { getMamRendererApi } from '../../renderer-api'
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
  activeClaim,
  localClaimantInstanceId,
  pending,
  onStart
}: Readonly<{
  input: MamStartAttemptInput
  activeAttemptIds: readonly string[]
  activeClaim?: TaskClaim
  localClaimantInstanceId: string
  pending: boolean
  onStart(input: MamStartAttemptInput): Promise<void>
}>): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string>()
  const [takeoverReason, setTakeoverReason] = useState('')
  const [sideEffectsChecked, setSideEffectsChecked] = useState(false)
  const isLocalClaim = activeClaim?.claimantInstanceId === localClaimantInstanceId
  const start = async (): Promise<void> => {
    setError(undefined)
    try {
      if (activeClaim && !isLocalClaim) {
        await getMamRendererApi().forceTakeoverTask({
          ...input,
          previousClaimId: activeClaim.claimId,
          expectedGeneration: activeClaim.generation,
          reason: takeoverReason
        })
      }
      await onStart(isLocalClaim ? { ...input, resumeNeedsAttention: true } : input)
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={pending}>
          <Play /> {isLocalClaim ? 'Continue' : activeClaim ? 'Force takeover' : 'Claim and run'}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isLocalClaim
              ? 'Continue this Task?'
              : activeClaim
                ? 'Force takeover this Task?'
                : 'Claim and run this Task?'}
          </DialogTitle>
          <DialogDescription>
            {isLocalClaim
              ? 'Continue the retained local Draft with the same Attempt and frozen configuration.'
              : activeClaim
              ? 'The current claimant will be fenced and cannot publish a late Delivery.'
              : 'Claim the fixed Workflow Task, then prepare its isolated local execution draft.'}
          </DialogDescription>
        </DialogHeader>
        {activeClaim && !isLocalClaim ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Claimed by {activeClaim.claimantInstanceId} at {activeClaim.claimedAt}.
            </p>
            <Textarea
              value={takeoverReason}
              onChange={(event) => setTakeoverReason(event.target.value)}
              placeholder="Reason for force takeover"
              aria-label="Force takeover reason"
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Missing local executors, credentials, or required resources stop before a Delivery is
            published.
          </p>
        )}
        {isLocalClaim && (
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={sideEffectsChecked}
              onCheckedChange={(checked) => setSideEffectsChecked(checked === true)}
            />
            <span>
              I checked whether the interrupted Role changed anything outside its isolated
              workspace and want to continue this Draft.
            </span>
          </label>
        )}
        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              pending ||
              Boolean(activeClaim && !isLocalClaim && !takeoverReason.trim()) ||
              Boolean(isLocalClaim && !sideEffectsChecked)
            }
            aria-busy={pending}
            onClick={() => void start()}
          >
            {pending ? <Loader2 className="animate-spin" /> : <Play />}
            {pending
              ? 'Starting Task...'
              : isLocalClaim
                ? 'Continue Draft'
                : activeClaim
                ? 'Force takeover and run'
                : 'Claim and run'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
