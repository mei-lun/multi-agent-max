import type { ExecutorProfile } from '../../../../shared/mam/domain/execution-profile'
import type { MamLocalSettings } from '../../../../shared/mam/local-settings'
import type { MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import { MamProfileCheckbox, MamProfileTextField } from './MamProfileFieldControls'
import { MamLocalKnowledgeBindings } from './MamLocalKnowledgeBindings'
import { MamLocalMcpConnections } from './MamLocalMcpConnections'

type LocalCatalog = Pick<MamUiSnapshot, 'executors' | 'providers' | 'mcpServers' | 'knowledgeBases'>

export function MamLocalProfileBindings({
  settings,
  catalog,
  onChange
}: Readonly<{
  settings: MamLocalSettings
  catalog: LocalCatalog
  onChange(settings: MamLocalSettings): void
}>): React.JSX.Element {
  const executorIds = [
    ...new Set([
      ...catalog.executors.map((profile) => profile.id),
      ...settings.executorBindings.map((binding) => binding.executorProfileId)
    ])
  ]
  const executors = new Map(catalog.executors.map((profile) => [profile.id, profile]))
  const secretRefs = [
    ...new Set([
      ...catalog.providers.flatMap((profile) => (profile.secretRef ? [profile.secretRef] : [])),
      ...catalog.mcpServers.flatMap((profile) =>
        profile.credentialRef ? [profile.credentialRef] : []
      ),
      ...catalog.knowledgeBases.flatMap((profile) =>
        profile.credentialRef ? [profile.credentialRef] : []
      ),
      ...settings.secretBindings.map((binding) => binding.secretRef)
    ])
  ]
  return (
    <div className="space-y-4">
      <LocalExecutorFields
        settings={settings}
        executorIds={executorIds}
        executors={executors}
        onChange={onChange}
      />
      <MamLocalKnowledgeBindings
        settings={settings}
        knowledgeBases={catalog.knowledgeBases}
        onChange={onChange}
      />
      <MamLocalMcpConnections
        settings={settings}
        mcpServers={catalog.mcpServers}
        onChange={onChange}
      />
      <LocalSecretFields settings={settings} secretRefs={secretRefs} onChange={onChange} />
    </div>
  )
}

function LocalExecutorFields({
  settings,
  executorIds,
  executors,
  onChange
}: Readonly<{
  settings: MamLocalSettings
  executorIds: readonly string[]
  executors: ReadonlyMap<string, ExecutorProfile>
  onChange(settings: MamLocalSettings): void
}>): React.JSX.Element {
  return (
    <fieldset className="space-y-2">
      <div>
        <legend className="text-xs font-medium">Local executors</legend>
        <p className="text-xs text-muted-foreground">
          Enable the executors installed on this Mac and confirm their local paths.
        </p>
      </div>
      {executorIds.length === 0 ? (
        <EmptyBindingState message="Create an Executor Profile above before adding its local path." />
      ) : (
        <div className="space-y-2">
          {executorIds.map((id) => {
            const profile = executors.get(id)
            const binding = settings.executorBindings.find(
              (candidate) => candidate.executorProfileId === id
            )
            return (
              <div key={id} className="space-y-3 rounded-md border border-border p-3">
                <MamProfileCheckbox
                  label={executorLabel(profile, id)}
                  description={binding ? 'Ready for local preflight' : 'Not configured on this Mac'}
                  checked={Boolean(binding)}
                  onChange={(enabled) =>
                    onChange(toggleExecutorBinding(settings, profile, id, enabled))
                  }
                />
                {binding && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <MamProfileTextField
                      label="Executable path"
                      value={binding.executablePath}
                      placeholder={profile?.executableRef ?? id}
                      mono
                      onChange={(executablePath) =>
                        onChange(updateExecutorBinding(settings, id, { executablePath }))
                      }
                    />
                    <MamProfileTextField
                      label="Configuration folder"
                      value={binding.configRoot}
                      placeholder="."
                      mono
                      onChange={(configRoot) =>
                        onChange(updateExecutorBinding(settings, id, { configRoot }))
                      }
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </fieldset>
  )
}

function LocalSecretFields({
  settings,
  secretRefs,
  onChange
}: Readonly<{
  settings: MamLocalSettings
  secretRefs: readonly string[]
  onChange(settings: MamLocalSettings): void
}>): React.JSX.Element {
  return (
    <fieldset className="space-y-2">
      <div>
        <legend className="text-xs font-medium">Local secrets</legend>
        <p className="text-xs text-muted-foreground">
          Keys entered through Add model connection are encrypted on this Mac. Environment variables
          remain available as an advanced fallback.
        </p>
      </div>
      {secretRefs.length === 0 ? (
        <EmptyBindingState message="Provider and resource credential references appear here." />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {secretRefs.map((secretRef) => {
            const binding = settings.secretBindings.find(
              (candidate) => candidate.secretRef === secretRef
            )
            const bindingId = binding?.id ?? secretRef
            return (
              <MamProfileCheckbox
                key={secretRef}
                label={secretRef}
                description={`Configured locally · fallback ${secretEnvironmentName(bindingId)}`}
                checked={Boolean(binding)}
                onChange={(enabled) =>
                  onChange(toggleSecretBinding(settings, secretRef, bindingId, enabled))
                }
              />
            )
          })}
        </div>
      )}
    </fieldset>
  )
}

function toggleExecutorBinding(
  settings: MamLocalSettings,
  profile: ExecutorProfile | undefined,
  executorProfileId: string,
  enabled: boolean
): MamLocalSettings {
  const current = settings.executorBindings.filter(
    (binding) => binding.executorProfileId !== executorProfileId
  )
  if (!enabled) return { ...settings, executorBindings: current }
  return {
    ...settings,
    executorBindings: [
      ...current,
      {
        id: executorProfileId,
        executorProfileId,
        executablePath: profile?.executableRef ?? executorProfileId,
        configRoot: '.',
        bindingIdentity: settings.bindingIdentity
      }
    ]
  }
}

function updateExecutorBinding(
  settings: MamLocalSettings,
  executorProfileId: string,
  update: Readonly<{ executablePath?: string; configRoot?: string }>
): MamLocalSettings {
  return {
    ...settings,
    executorBindings: settings.executorBindings.map((binding) =>
      binding.executorProfileId === executorProfileId ? { ...binding, ...update } : binding
    )
  }
}

function toggleSecretBinding(
  settings: MamLocalSettings,
  secretRef: string,
  id: string,
  enabled: boolean
): MamLocalSettings {
  const current = settings.secretBindings.filter((binding) => binding.secretRef !== secretRef)
  return {
    ...settings,
    secretBindings: enabled
      ? [...current, { id, secretRef, bindingIdentity: settings.bindingIdentity }]
      : current
  }
}

function secretEnvironmentName(bindingId: string): string {
  return `MAM_SECRET_${bindingId.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`
}

function executorLabel(profile: ExecutorProfile | undefined, id: string): string {
  return `${profile?.kind ?? 'Executor'} · ${id}`
}

function EmptyBindingState({ message }: Readonly<{ message: string }>): React.JSX.Element {
  return (
    <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
      {message}
    </p>
  )
}
