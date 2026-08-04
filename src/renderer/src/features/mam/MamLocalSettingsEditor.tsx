import { Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { MamSaveLocalSettingsInput } from '../../../../shared/mam/application-command'
import {
  MamLocalSettingsSchema,
  type MamLocalSettings
} from '../../../../shared/mam/local-settings'
import type { MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Textarea } from '../../components/ui/textarea'
import { MamLocalProfileBindings } from './MamLocalProfileBindings'
import { MamWorkflowLabeledField } from './MamWorkflowFieldControls'

export function MamLocalSettingsEditor({
  settings,
  catalog,
  projectDirectory,
  pending,
  onSave
}: Readonly<{
  settings: MamLocalSettings
  catalog: Pick<MamUiSnapshot, 'executors' | 'providers' | 'mcpServers' | 'knowledgeBases'>
  projectDirectory?: string
  pending: boolean
  onSave(input: MamSaveLocalSettingsInput): Promise<void>
}>): React.JSX.Element {
  const [draft, setDraft] = useState(settings)
  const [source, setSource] = useState(JSON.stringify(settings, null, 2))
  const [error, setError] = useState<string>()
  useEffect(() => {
    setDraft(settings)
    setSource(JSON.stringify(settings, null, 2))
    setError(undefined)
  }, [settings])
  const update = (next: MamLocalSettings): void => {
    setDraft(next)
    setSource(JSON.stringify(next, null, 2))
  }
  const applyJson = (): void => {
    try {
      const next = MamLocalSettingsSchema.parse(JSON.parse(source))
      setDraft(next)
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const save = async (): Promise<void> => {
    setError(undefined)
    try {
      await onSave({ settings: draft })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Machine-local bindings</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Paths and secret references stay outside Git and frozen Run state.
          </p>
        </div>
        <Badge variant="outline">{draft.bindingIdentity}</Badge>
      </div>
      <MamWorkflowLabeledField
        label="Git executable"
        description="Used for native project and mam-state commands; Git 2.25 is the baseline."
      >
        <Input
          className="font-mono"
          value={draft.gitExecutable}
          onChange={(event) => update({ ...draft, gitExecutable: event.target.value })}
        />
      </MamWorkflowLabeledField>
      <MamWorkflowLabeledField label="Default project directory">
        <Input
          className="font-mono"
          value={draft.defaultProjectDirectory ?? ''}
          placeholder={projectDirectory ?? 'Choose a directory'}
          onChange={(event) => update(withDefaultDirectory(draft, event.target.value))}
        />
      </MamWorkflowLabeledField>
      {projectDirectory && (
        <p className="text-xs text-muted-foreground">
          Attached now: <span className="font-mono">{projectDirectory}</span>
        </p>
      )}
      <MamLocalProfileBindings settings={draft} catalog={catalog} onChange={update} />
      <details className="rounded-md border border-border p-3">
        <summary className="cursor-pointer text-xs font-medium">Advanced local JSON</summary>
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            A secret binding ID resolves from MAM_SECRET_ plus its uppercased ID, with punctuation
            replaced by underscores. Secret values are never stored here.
          </p>
          <Textarea
            className="min-h-72 font-mono"
            value={source}
            aria-invalid={Boolean(error)}
            onChange={(event) => setSource(event.target.value)}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button variant="outline" size="xs" onClick={applyJson}>
            Apply local JSON
          </Button>
        </div>
      </details>
      <div className="flex justify-end">
        <Button size="sm" disabled={pending} onClick={() => void save()}>
          <Save /> Save local settings
        </Button>
      </div>
    </div>
  )
}

function withDefaultDirectory(settings: MamLocalSettings, value: string): MamLocalSettings {
  const { defaultProjectDirectory: _, ...base } = settings
  return value.trim() ? { ...base, defaultProjectDirectory: value.trim() } : base
}
