import { Database, PackageOpen, Server, Upload } from 'lucide-react'
import type { MamSaveProfileInput } from '../../../../shared/mam/application-command'
import type { MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { MamProfileEditorDialog } from './MamProfileEditorDialog'
import { mamProfileTemplate } from './mam-profile-templates'

export function MamResourcesPage({
  snapshot,
  pending,
  onSaveProfile,
  onImportSkill
}: Readonly<{
  snapshot: MamUiSnapshot
  pending: boolean
  onSaveProfile(input: MamSaveProfileInput): Promise<void>
  onImportSkill(): Promise<void>
}>): React.JSX.Element {
  return (
    <section aria-labelledby="resources-title" className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 id="resources-title" className="text-xl font-semibold">
            Resources
          </h1>
          <p className="text-sm text-muted-foreground">
            Versioned Skills, MCP servers, Knowledge Bases, and their Role allowlists.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="xs"
            disabled={pending}
            onClick={() => void onImportSkill()}
          >
            <Upload /> Import Skill
          </Button>
          <MamProfileEditorDialog
            kind="mcp"
            template={mamProfileTemplate('mcp', snapshot)}
            pending={pending}
            onSave={onSaveProfile}
          />
          <MamProfileEditorDialog
            kind="knowledge"
            template={mamProfileTemplate('knowledge', snapshot)}
            pending={pending}
            onSave={onSaveProfile}
          />
        </div>
      </div>
      <ResourceSection title="Skill Registry" icon={PackageOpen} empty="No imported Skills">
        {snapshot.skills.map((skill) => (
          <ResourceCard
            key={skill.id}
            title={skill.name}
            id={skill.id}
            version={skill.version}
            metadata={`${skill.supportedExecutors.join(', ')} · ${skill.enabled ? 'enabled' : 'disabled'}`}
            roleCount={
              snapshot.roles.filter((role) =>
                role.skillBindings.some((binding) => binding.skillId === skill.id)
              ).length
            }
            action={
              <MamProfileEditorDialog
                kind="skill"
                profile={skill}
                template={skill}
                pending={pending}
                onSave={onSaveProfile}
              />
            }
          />
        ))}
      </ResourceSection>
      <ResourceSection title="MCP Server Profiles" icon={Server} empty="No MCP Server Profiles">
        {snapshot.mcpServers.map((server) => (
          <ResourceCard
            key={server.id}
            title={server.displayName}
            id={server.id}
            version={server.version}
            metadata={`${server.transport} · ${server.connectionRef}`}
            roleCount={
              snapshot.roles.filter((role) =>
                role.mcpBindings.some((binding) => binding.serverProfileId === server.id)
              ).length
            }
            action={
              <MamProfileEditorDialog
                kind="mcp"
                profile={server}
                template={server}
                pending={pending}
                onSave={onSaveProfile}
              />
            }
          />
        ))}
      </ResourceSection>
      <ResourceSection
        title="Knowledge Base Profiles"
        icon={Database}
        empty="No Knowledge Base Profiles"
      >
        {snapshot.knowledgeBases.map((knowledge) => (
          <ResourceCard
            key={knowledge.id}
            title={knowledge.displayName}
            id={knowledge.id}
            version={knowledge.version}
            metadata={`${knowledge.kind} · ${knowledge.sourceRef}`}
            roleCount={
              snapshot.roles.filter((role) =>
                role.knowledgeBaseBindings.some(
                  (binding) => binding.knowledgeBaseProfileId === knowledge.id
                )
              ).length
            }
            action={
              <MamProfileEditorDialog
                kind="knowledge"
                profile={knowledge}
                template={knowledge}
                pending={pending}
                onSave={onSaveProfile}
              />
            }
          />
        ))}
      </ResourceSection>
    </section>
  )
}

function ResourceSection({
  title,
  icon: Icon,
  empty,
  children
}: Readonly<{
  title: string
  icon: typeof PackageOpen
  empty: string
  children: React.ReactNode
}>): React.JSX.Element {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children)
  return (
    <div className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-muted-foreground" /> {title}
      </h2>
      {hasChildren ? (
        <div className="grid gap-3 lg:grid-cols-2">{children}</div>
      ) : (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
          {empty}
        </p>
      )}
    </div>
  )
}

function ResourceCard({
  title,
  id,
  version,
  metadata,
  roleCount,
  action
}: Readonly<{
  title: string
  id: string
  version: number
  metadata: string
  roleCount: number
  action: React.ReactNode
}>): React.JSX.Element {
  return (
    <article className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{title}</h3>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{id}</p>
        </div>
        <Badge variant="outline">v{version}</Badge>
      </div>
      <p className="mt-3 truncate text-xs text-muted-foreground">{metadata}</p>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
        <span className="text-xs text-muted-foreground">Allowed by {roleCount} Roles</span>
        {action}
      </div>
    </article>
  )
}
