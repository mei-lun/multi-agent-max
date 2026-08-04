import { CopyPlus, FilePlus2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  MamSaveProfileInputSchema,
  type MamSaveProfileInput
} from '../../../../shared/mam/application-command'
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
import { Textarea } from '../../components/ui/textarea'
import { MamProfileForm } from './MamProfileForm'

type Profile = MamSaveProfileInput['profile']

export function MamProfileEditorDialog({
  kind,
  profile,
  template,
  snapshot,
  pending,
  onSave
}: Readonly<{
  kind: MamSaveProfileInput['kind']
  profile?: Readonly<{ id: string; version: number }>
  template: Profile
  snapshot: MamUiSnapshot
  pending: boolean
  onSave(input: MamSaveProfileInput): Promise<void>
}>): React.JSX.Element {
  const initial = profileDraft(profile, template)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(initial)
  const [source, setSource] = useState(profileSource(initial))
  const [error, setError] = useState<string>()

  useEffect(() => reset(profileDraft(profile, template)), [profile, template])

  const reset = (next: Profile): void => {
    setDraft(next)
    setSource(profileSource(next))
    setError(undefined)
  }
  const update = (next: Profile): void => reset(next)
  const applyJson = (): void => {
    try {
      const input = MamSaveProfileInputSchema.parse({ kind, profile: JSON.parse(source) })
      setDraft(input.profile)
      setSource(profileSource(input.profile))
      setError(undefined)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }
  const save = async (): Promise<void> => {
    try {
      const input = MamSaveProfileInputSchema.parse({ kind, profile: draft })
      await onSave(input)
      setOpen(false)
      setError(undefined)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }
  const changeOpen = (next: boolean): void => {
    if (next) reset(profileDraft(profile, template))
    setOpen(next)
  }
  const title = profile ? `New ${kind} version` : `New ${kind} Profile`
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
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
            Fill in the common settings below. Existing Runs and Attempts keep their frozen versions
            when you save.
          </DialogDescription>
        </DialogHeader>
        <MamProfileForm kind={kind} profile={draft} snapshot={snapshot} onChange={update} />
        <details className="rounded-md border border-border p-3">
          <summary className="cursor-pointer text-xs font-medium">Advanced JSON</summary>
          <div className="mt-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              Use this only for settings not shown above. Secret values are rejected; use a secret
              or credential reference.
            </p>
            <Textarea
              className="min-h-72 font-mono"
              value={source}
              aria-invalid={Boolean(error)}
              onChange={(event) => setSource(event.target.value)}
            />
            <Button variant="outline" size="xs" onClick={applyJson}>
              Apply JSON
            </Button>
          </div>
        </details>
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

function profileDraft(
  profile: Readonly<{ id: string; version: number }> | undefined,
  template: Profile
): Profile {
  return structuredClone(profile ? { ...template, version: profile.version + 1 } : template)
}

function profileSource(profile: Profile): string {
  return JSON.stringify(profile, null, 2)
}

function errorMessage(cause: unknown): string {
  if (isValidationError(cause)) {
    return cause.issues
      .slice(0, 3)
      .map((issue) => {
        const path = issue.path.filter((part) => part !== 'profile').join('.')
        return path ? `${path}: ${issue.message}` : issue.message
      })
      .join('\n')
  }
  return cause instanceof Error ? cause.message : String(cause)
}

function isValidationError(
  cause: unknown
): cause is { issues: { path: PropertyKey[]; message: string }[] } {
  if (!cause || typeof cause !== 'object' || !('issues' in cause)) return false
  return Array.isArray(cause.issues)
}
