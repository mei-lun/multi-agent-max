import { Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'
import { RoleProfileSchema, type RoleProfile } from '../../../../shared/mam/domain/role'
import type { MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import { Button } from '../../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '../../components/ui/dialog'
import { MamProfileForm } from './MamProfileForm'

export function MamDesignRoleDialog({
  role,
  snapshot,
  pending,
  onSave
}: Readonly<{
  role: RoleProfile
  snapshot: MamUiSnapshot
  pending: boolean
  onSave(role: RoleProfile): Promise<void>
}>): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(role)
  const [error, setError] = useState<string>()
  useEffect(() => setDraft(role), [role])
  const save = async (): Promise<void> => {
    try {
      await onSave(RoleProfileSchema.parse(draft))
      setOpen(false)
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(role)
        setOpen(next)
        setError(undefined)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="xs" aria-label="Edit generated role">
          <Pencil /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit generated Role</DialogTitle>
          <DialogDescription>
            Changes stay in this local Design draft until the full proposal is confirmed.
          </DialogDescription>
        </DialogHeader>
        <MamProfileForm
          kind="role"
          profile={draft}
          snapshot={snapshot}
          onChange={(profile) => setDraft(profile as RoleProfile)}
        />
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={() => void save()}>
            Save draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
