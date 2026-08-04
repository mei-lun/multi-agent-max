import type {
  KnowledgeBaseProfile,
  LocalKnowledgeBinding
} from '../../../../shared/mam/domain/resource-profile'
import type { MamLocalSettings } from '../../../../shared/mam/local-settings'
import { MamProfileTextField } from './MamProfileFieldControls'

export function MamLocalKnowledgeBindings({
  settings,
  knowledgeBases,
  onChange
}: Readonly<{
  settings: MamLocalSettings
  knowledgeBases: readonly KnowledgeBaseProfile[]
  onChange(settings: MamLocalSettings): void
}>): React.JSX.Element {
  const localRepositories = knowledgeBases.filter(
    (profile) => profile.kind === 'local-directory' || profile.kind === 'git-repository'
  )
  return (
    <fieldset className="space-y-2">
      <div>
        <legend className="text-xs font-medium">Local knowledge repositories</legend>
        <p className="text-xs text-muted-foreground">
          Give each knowledge base its own local folder. Leave a path empty to keep that knowledge
          base unavailable on this Mac.
        </p>
      </div>
      {localRepositories.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          Create a Local folder or Git repository knowledge base above before choosing its path.
        </p>
      ) : (
        <div className="space-y-2">
          {localRepositories.map((profile) => (
            <KnowledgeRepositoryFields
              key={profile.id}
              profile={profile}
              settings={settings}
              onChange={onChange}
            />
          ))}
        </div>
      )}
    </fieldset>
  )
}

function KnowledgeRepositoryFields({
  profile,
  settings,
  onChange
}: Readonly<{
  profile: KnowledgeBaseProfile
  settings: MamLocalSettings
  onChange(settings: MamLocalSettings): void
}>): React.JSX.Element {
  const binding = settings.knowledgeBindings.find(
    (candidate) => candidate.knowledgeBaseProfileId === profile.id
  )
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div>
        <p className="text-xs font-medium">{profile.displayName}</p>
        <p className="font-mono text-[11px] text-muted-foreground">
          {profile.kind} · {profile.sourceRef}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <MamProfileTextField
          label="Local repository or folder path"
          value={binding?.sourcePath ?? ''}
          placeholder="/Users/me/knowledge/product-docs"
          mono
          onChange={(sourcePath) =>
            onChange(setLocalKnowledgePath(settings, profile.id, sourcePath))
          }
        />
        {binding && (
          <MamProfileTextField
            label="Index revision (optional)"
            value={binding.indexRevision ?? ''}
            placeholder="main or commit ID"
            mono
            onChange={(indexRevision) =>
              onChange(updateLocalKnowledgeIndexRevision(settings, profile.id, indexRevision))
            }
          />
        )}
      </div>
    </div>
  )
}

export function setLocalKnowledgePath(
  settings: MamLocalSettings,
  knowledgeBaseProfileId: string,
  sourcePath: string
): MamLocalSettings {
  const existing = settings.knowledgeBindings.find(
    (binding) => binding.knowledgeBaseProfileId === knowledgeBaseProfileId
  )
  const remaining = settings.knowledgeBindings.filter(
    (binding) => binding.knowledgeBaseProfileId !== knowledgeBaseProfileId
  )
  if (!sourcePath.trim()) return { ...settings, knowledgeBindings: remaining }
  const binding: LocalKnowledgeBinding = {
    id: existing?.id ?? knowledgeBaseProfileId,
    knowledgeBaseProfileId,
    bindingIdentity: settings.bindingIdentity,
    sourcePath,
    ...(existing?.indexRevision ? { indexRevision: existing.indexRevision } : {})
  }
  return { ...settings, knowledgeBindings: [...remaining, binding] }
}

export function updateLocalKnowledgeIndexRevision(
  settings: MamLocalSettings,
  knowledgeBaseProfileId: string,
  value: string
): MamLocalSettings {
  return {
    ...settings,
    knowledgeBindings: settings.knowledgeBindings.map((binding) => {
      if (binding.knowledgeBaseProfileId !== knowledgeBaseProfileId) return binding
      const { indexRevision: _, ...base } = binding
      return value.trim() ? { ...base, indexRevision: value.trim() } : base
    })
  }
}
