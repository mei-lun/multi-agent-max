import { CopyPlus, FilePlus2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  MamSaveProfileInputSchema,
  type MamSaveProfileInput
} from '../../../../shared/mam/application-command'
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
import { Textarea } from '../../components/ui/textarea'
import { MamWorkflowLabeledField } from './MamWorkflowFieldControls'

export function MamProfileEditorDialog({
  kind,
  profile,
  template,
  pending,
  onSave
}: Readonly<{
  kind: MamSaveProfileInput['kind']
  profile?: Readonly<{ id: string; version: number }>
  template: MamSaveProfileInput['profile']
  pending: boolean
  onSave(input: MamSaveProfileInput): Promise<void>
}>): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState(profileSource(profile, template))
  const [error, setError] = useState<string>()
  useEffect(() => {
    setSource(profileSource(profile, template))
    setError(undefined)
  }, [profile, template])
  const save = async (): Promise<void> => {
    try {
      const input = MamSaveProfileInputSchema.parse({ kind, profile: JSON.parse(source) })
      await onSave(input)
      setOpen(false)
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const title = profile ? `New ${kind} version` : `New ${kind} Profile`
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="xs">
          {profile ? <CopyPlus /> : <FilePlus2 />}
          {profile ? 'New version' : `New ${kind}`}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Profiles are immutable. Saving validates and activates this exact new version locally;
            existing Runs and Attempts keep their frozen snapshots.
          </DialogDescription>
        </DialogHeader>
        <MamWorkflowLabeledField
          label="Profile JSON"
          description="Secret values are rejected; use secretRef or credentialRef fields."
        >
          <Textarea
            className="min-h-[26rem] font-mono"
            value={source}
            aria-invalid={Boolean(error)}
            onChange={(event) => setSource(event.target.value)}
          />
        </MamWorkflowLabeledField>
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
            Save and activate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function profileSource(
  profile: Readonly<{ id: string; version: number }> | undefined,
  template: MamSaveProfileInput['profile']
): string {
  return JSON.stringify(profile ? { ...profile, version: profile.version + 1 } : template, null, 2)
}
