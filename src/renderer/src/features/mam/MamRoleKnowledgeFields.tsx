import type { RoleProfile } from '../../../../shared/mam/domain/role'
import type { MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import { MamProfileCheckbox } from './MamProfileFieldControls'

export function MamRoleKnowledgeFields({
  profile,
  snapshot,
  onChange
}: Readonly<{
  profile: RoleProfile
  snapshot: MamUiSnapshot
  onChange(profile: RoleProfile): void
}>): React.JSX.Element | null {
  if (!snapshot.knowledgeBases.length) return null
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-xs font-medium">Knowledge bases</h3>
        <p className="text-[11px] text-muted-foreground">
          Choose one or more knowledge bases this role may search and read.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {snapshot.knowledgeBases.map((knowledge) => (
          <div key={knowledge.id} className="rounded-md border border-border p-3">
            <MamProfileCheckbox
              label={knowledge.displayName}
              description={`${knowledge.kind} · ${knowledge.sourceRef}`}
              checked={profile.knowledgeBaseBindings.some(
                (binding) => binding.knowledgeBaseProfileId === knowledge.id
              )}
              onChange={(enabled) => onChange(toggleKnowledge(profile, knowledge.id, enabled))}
            />
          </div>
        ))}
      </div>
    </section>
  )
}

function toggleKnowledge(profile: RoleProfile, id: string, enabled: boolean): RoleProfile {
  const current = profile.knowledgeBaseBindings.filter(
    (binding) => binding.knowledgeBaseProfileId !== id
  )
  return {
    ...profile,
    knowledgeBaseBindings: enabled ? [...current, { knowledgeBaseProfileId: id }] : current
  }
}
