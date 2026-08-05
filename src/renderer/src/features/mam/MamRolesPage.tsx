import { Bot, BrainCircuit, Database } from 'lucide-react'
import { useState } from 'react'
import type { MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import { Badge } from '../../components/ui/badge'
import type {
  MamDeleteRoleProfileInput,
  MamSaveProfileInput
} from '../../../../shared/mam/application-command'
import { MamDeleteRoleDialog } from './MamDeleteRoleDialog'
import { MamProfileEditorDialog } from './MamProfileEditorDialog'
import { MamWorkflowRoleFilter } from './MamWorkflowRoleFilter'
import { mamProfileTemplate } from './mam-profile-templates'
import { rolesForWorkflow } from './mam-workflow-role-filter'

export function MamRolesPage({
  snapshot,
  pending,
  onSaveProfile,
  onDeleteRoleProfile
}: Readonly<{
  snapshot: MamUiSnapshot
  pending: boolean
  onSaveProfile(input: MamSaveProfileInput): Promise<void>
  onDeleteRoleProfile(input: MamDeleteRoleProfileInput): Promise<void>
}>): React.JSX.Element {
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>()
  const selectedWorkflow = snapshot.workflows.find((workflow) => workflow.id === selectedWorkflowId)
  const roles = rolesForWorkflow(snapshot.roles, selectedWorkflow)
  return (
    <section aria-labelledby="roles-title" className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 id="roles-title" className="text-xl font-semibold">
            Roles
          </h1>
          <p className="text-sm text-muted-foreground">
            Versioned execution, resource, and budget profiles.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <MamWorkflowRoleFilter
            workflows={snapshot.workflows}
            workflow={selectedWorkflow}
            onChange={setSelectedWorkflowId}
          />
          <MamProfileEditorDialog
            kind="role"
            template={mamProfileTemplate('role', snapshot)}
            snapshot={snapshot}
            pending={pending}
            onSave={onSaveProfile}
          />
        </div>
      </div>

      {snapshot.roles.length === 0 ? (
        <EmptyRoles />
      ) : roles.length === 0 ? (
        <EmptyWorkflowRoles />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {roles.map((role) => (
            <article key={role.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold">{role.displayName}</h2>
                  <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{role.id}</p>
                </div>
                <Badge variant="outline">v{role.version}</Badge>
              </div>

              <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
                <ProfileRow icon={Bot} label="Executor" value={role.execution.executorProfileId} />
                <ProfileRow
                  icon={BrainCircuit}
                  label="Model"
                  value={role.execution.modelProfileId}
                />
                <ProfileRow
                  icon={Database}
                  label="Resources"
                  value={`${role.skillBindings.length} skills · ${role.mcpBindings.length} MCP · ${role.knowledgeBaseBindings.length} knowledge`}
                />
              </dl>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
                <span>{role.budget.maxDurationSeconds}s maximum</span>
                <span aria-hidden="true">·</span>
                <span>${role.budget.maxCostUsd.toFixed(2)} budget</span>
                <span aria-hidden="true">·</span>
                <span>{role.retry.maxAttempts} attempts</span>
                <span className="ml-auto flex items-center gap-2">
                  <MamProfileEditorDialog
                    kind="role"
                    profile={role}
                    template={role}
                    snapshot={snapshot}
                    pending={pending}
                    onSave={onSaveProfile}
                  />
                  <MamDeleteRoleDialog
                    role={role}
                    snapshot={snapshot}
                    pending={pending}
                    onDelete={onDeleteRoleProfile}
                  />
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function ProfileRow({
  icon: Icon,
  label,
  value
}: Readonly<{
  icon: typeof Bot
  label: string
  value: string
}>): React.JSX.Element {
  return (
    <>
      <dt className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </dt>
      <dd className="min-w-0 truncate font-mono">{value}</dd>
    </>
  )
}

function EmptyRoles(): React.JSX.Element {
  return (
    <div className="rounded-xl border border-dashed border-border p-10 text-center">
      <Bot className="mx-auto mb-3 size-7 text-muted-foreground" />
      <p className="text-sm font-medium">No active Role Profiles</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Active versioned profiles appear after they are registered by the Application layer.
      </p>
    </div>
  )
}

function EmptyWorkflowRoles(): React.JSX.Element {
  return (
    <div className="rounded-xl border border-dashed border-border p-10 text-center">
      <Bot className="mx-auto mb-3 size-7 text-muted-foreground" />
      <p className="text-sm font-medium">No active Roles are bound to this Workflow</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Choose another Workflow or All Roles to change the list.
      </p>
    </div>
  )
}
