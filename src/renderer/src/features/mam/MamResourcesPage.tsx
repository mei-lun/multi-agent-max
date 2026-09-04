import { Database, PackageOpen, RefreshCw, Server, Upload } from 'lucide-react'
import { useState } from 'react'
import type { MamSaveProfileInput } from '../../../../shared/mam/application-command'
import type { MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import type {
  CodexResourceCandidate,
  MamImportCodexResourcesInput
} from '../../../../shared/mam/resource-import'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { MamProfileEditorDialog } from './MamProfileEditorDialog'
import { mamProfileTemplate } from './mam-profile-templates'
import { MamCodexResourceImportDialog } from './MamCodexResourceImportDialog'
import { resourceHealthView } from './mam-resource-health-view'

export function MamResourcesPage({
  snapshot,
  pending,
  onSaveProfile,
  onImportSkill,
  onListCodexResources,
  onImportCodexResources,
  onCheckResourceHealth
}: Readonly<{
  snapshot: MamUiSnapshot
  pending: boolean
  onSaveProfile(input: MamSaveProfileInput): Promise<void>
  onImportSkill(): Promise<void>
  onListCodexResources(): Promise<readonly CodexResourceCandidate[]>
  onImportCodexResources(input: MamImportCodexResourcesInput): Promise<void>
  onCheckResourceHealth(): Promise<void>
}>): React.JSX.Element {
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string>()
  const checkAll = async (): Promise<void> => {
    setChecking(true)
    setCheckError(undefined)
    try {
      await onCheckResourceHealth()
    } catch (cause) {
      setCheckError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setChecking(false)
    }
  }
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
          <MamCodexResourceImportDialog
            disabled={pending}
            onList={onListCodexResources}
            onImport={onImportCodexResources}
          />
          <Button
            className="w-28"
            variant="outline"
            size="xs"
            disabled={pending || checking}
            onClick={() => void checkAll()}
          >
            <RefreshCw className={checking ? 'animate-spin' : undefined} />
            {checking ? 'Checking…' : 'Check all'}
          </Button>
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
            snapshot={snapshot}
            pending={pending}
            onSave={onSaveProfile}
          />
          <MamProfileEditorDialog
            kind="knowledge"
            template={mamProfileTemplate('knowledge', snapshot)}
            snapshot={snapshot}
            pending={pending}
            onSave={onSaveProfile}
          />
        </div>
      </div>
      {checkError && (
        <p role="alert" className="text-sm text-destructive">
          Resource health check failed: {checkError}
        </p>
      )}
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
            health={resourceHealthView('skill', skill.id, skill.version, snapshot.resourceHealth)}
            action={
              <MamProfileEditorDialog
                kind="skill"
                profile={skill}
                template={skill}
                snapshot={snapshot}
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
            health={resourceHealthView('mcp', server.id, server.version, snapshot.resourceHealth)}
            action={
              <MamProfileEditorDialog
                kind="mcp"
                profile={server}
                template={server}
                snapshot={snapshot}
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
            health={resourceHealthView(
              'knowledge',
              knowledge.id,
              knowledge.version,
              snapshot.resourceHealth
            )}
            action={
              <MamProfileEditorDialog
                kind="knowledge"
                profile={knowledge}
                template={knowledge}
                snapshot={snapshot}
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
        <p className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
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
  health,
  action
}: Readonly<{
  title: string
  id: string
  version: number
  metadata: string
  roleCount: number
  health: ReturnType<typeof resourceHealthView>
  action: React.ReactNode
}>): React.JSX.Element {
  return (
    <article className="rounded-md border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{title}</h3>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{id}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Badge variant={health.variant}>{health.label}</Badge>
          <Badge variant="outline">v{version}</Badge>
        </div>
      </div>
      <p className="mt-3 truncate text-xs text-muted-foreground">{metadata}</p>
      {health.message && (
        <p className="mt-2 text-xs text-destructive">
          {health.message}
          {health.checkedAt ? ` Checked ${new Date(health.checkedAt).toLocaleString()}.` : ''}
        </p>
      )}
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
        <span className="text-xs text-muted-foreground">Allowed by {roleCount} Roles</span>
        {action}
      </div>
    </article>
  )
}
