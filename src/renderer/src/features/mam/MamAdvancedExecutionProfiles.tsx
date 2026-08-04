import type { MamSaveProfileInput } from '../../../../shared/mam/application-command'
import type { MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import { MamProfileEditorDialog } from './MamProfileEditorDialog'
import { mamProfileTemplate } from './mam-profile-templates'

export function MamAdvancedExecutionProfiles({
  snapshot,
  pending,
  onSave
}: Readonly<{
  snapshot: MamUiSnapshot
  pending: boolean
  onSave(input: MamSaveProfileInput): Promise<void>
}>): React.JSX.Element {
  return (
    <details className="rounded-md border border-border p-3">
      <summary className="cursor-pointer text-xs font-medium">Advanced profile setup</summary>
      <p className="mt-2 text-xs text-muted-foreground">
        Create Executor, Provider, and Model Profiles separately when you need custom JSON-level
        control.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {(['executor', 'provider', 'model'] as const).map((kind) => (
          <MamProfileEditorDialog
            key={kind}
            kind={kind}
            template={mamProfileTemplate(kind, snapshot)}
            snapshot={snapshot}
            pending={pending}
            onSave={onSave}
          />
        ))}
      </div>
    </details>
  )
}
