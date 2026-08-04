import type { RoleProfile } from '../../../../shared/mam/domain/role'
import type { MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import { MamProfileCheckbox } from './MamProfileFieldControls'
import { MamRoleKnowledgeFields } from './MamRoleKnowledgeFields'

export function MamRoleResourceFields({
  profile,
  snapshot,
  onChange
}: Readonly<{
  profile: RoleProfile
  snapshot: MamUiSnapshot
  onChange(profile: RoleProfile): void
}>): React.JSX.Element | null {
  if (!snapshot.skills.length && !snapshot.mcpServers.length && !snapshot.knowledgeBases.length) {
    return null
  }
  return (
    <fieldset className="space-y-3">
      <div>
        <legend className="text-xs font-medium">Resources</legend>
        <p className="text-xs text-muted-foreground">
          Select the Skills, MCP servers, and knowledge bases this role may use.
        </p>
      </div>
      <SkillBindings profile={profile} snapshot={snapshot} onChange={onChange} />
      <McpBindings profile={profile} snapshot={snapshot} onChange={onChange} />
      <MamRoleKnowledgeFields profile={profile} snapshot={snapshot} onChange={onChange} />
    </fieldset>
  )
}

function SkillBindings(props: ResourceProps): React.JSX.Element | null {
  const executorKind = props.snapshot.executors.find(
    (executor) => executor.id === props.profile.execution.executorProfileId
  )?.kind
  if (!props.snapshot.skills.length) return null
  return (
    <ResourceGroup title="Skills" description="Choose which Skills this role may use.">
      <div className="grid gap-2 sm:grid-cols-2">
        {props.snapshot.skills.map((skill) => {
          const supported = !executorKind || skill.supportedExecutors.includes(executorKind)
          const selected = props.profile.skillBindings.some(
            (binding) => binding.skillId === skill.id
          )
          return (
            <div key={skill.id} className="rounded-md border border-border p-3">
              <MamProfileCheckbox
                label={skill.name}
                description={
                  supported ? skill.description || skill.id : 'Not supported by executor'
                }
                checked={selected}
                disabled={!supported}
                onChange={(enabled) =>
                  props.onChange(toggleSkill(props.profile, skill.id, enabled))
                }
              />
            </div>
          )
        })}
      </div>
    </ResourceGroup>
  )
}

function McpBindings(props: ResourceProps): React.JSX.Element | null {
  if (!props.snapshot.mcpServers.length) return null
  return (
    <ResourceGroup title="MCP servers" description="Choose which MCP servers this role may use.">
      <div className="grid gap-2 sm:grid-cols-2">
        {props.snapshot.mcpServers.map((server) => (
          <div key={server.id} className="rounded-md border border-border p-3">
            <MamProfileCheckbox
              label={server.displayName}
              description={`${server.transport} · ${server.connectionRef}`}
              checked={props.profile.mcpBindings.some(
                (binding) => binding.serverProfileId === server.id
              )}
              onChange={(enabled) => props.onChange(toggleMcp(props.profile, server.id, enabled))}
            />
          </div>
        ))}
      </div>
    </ResourceGroup>
  )
}

type ResourceProps = Readonly<{
  profile: RoleProfile
  snapshot: MamUiSnapshot
  onChange(profile: RoleProfile): void
}>

function ResourceGroup({
  title,
  description,
  children
}: Readonly<{ title: string; description: string; children: React.ReactNode }>): React.JSX.Element {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-xs font-medium">{title}</h3>
        <p className="text-[11px] text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  )
}

function toggleSkill(profile: RoleProfile, id: string, enabled: boolean): RoleProfile {
  const current = profile.skillBindings.filter((binding) => binding.skillId !== id)
  return { ...profile, skillBindings: enabled ? [...current, { skillId: id }] : current }
}

function toggleMcp(profile: RoleProfile, id: string, enabled: boolean): RoleProfile {
  const current = profile.mcpBindings.filter((binding) => binding.serverProfileId !== id)
  return { ...profile, mcpBindings: enabled ? [...current, { serverProfileId: id }] : current }
}
