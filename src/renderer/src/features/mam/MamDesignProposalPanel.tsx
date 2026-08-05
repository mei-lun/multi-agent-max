import { AlertTriangle, CheckCircle2, Network, Sparkles, Users } from 'lucide-react'
import { useState } from 'react'
import type { MamDesignDraft, MamDesignProposal } from '../../../../shared/mam/design-assistant'
import type { RoleProfile } from '../../../../shared/mam/domain/role'
import type { MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../../components/ui/dialog'
import { MamDesignRoleDialog } from './MamDesignRoleDialog'
import { MamDesignRecoveryCard } from './MamDesignRecoveryCard'

export function MamDesignProposalPanel({
  draft,
  snapshot,
  pending,
  onUpdateRole,
  onEditWorkflow,
  onApply,
  onCreateTemplate,
  onRetry
}: Readonly<{
  draft: MamDesignDraft
  snapshot: MamUiSnapshot
  pending: boolean
  onUpdateRole(role: RoleProfile): Promise<void>
  onEditWorkflow(): void
  onApply(): Promise<void>
  onCreateTemplate(): Promise<void>
  onRetry(): Promise<void>
}>): React.JSX.Element {
  const proposal = draft.proposal
  const [confirmTemplate, setConfirmTemplate] = useState(false)
  const loadTemplate = (): void => {
    if (proposal) setConfirmTemplate(true)
    else void onCreateTemplate()
  }
  return (
    <aside className="scrollbar-sleek min-h-0 overflow-y-auto bg-card" aria-label="Design proposal">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Proposal</h2>
          {proposal && <ProposalState proposal={proposal} status={draft.status} />}
        </div>
        {proposal && draft.status === 'draft' && (
          <ApplyProposalDialog
            proposal={proposal}
            revision={draft.workflowRevision}
            pending={pending}
            onApply={onApply}
          />
        )}
      </header>
      {draft.recovery && draft.status === 'draft' && (
        <div className={proposal ? 'px-4 pt-4' : 'p-4'}>
          <MamDesignRecoveryCard
            recovery={draft.recovery}
            pending={pending}
            onRetry={onRetry}
            onTemplate={async () => loadTemplate()}
          />
        </div>
      )}
      {!proposal ? (
        <div className="flex min-h-96 flex-col items-center justify-center p-8 text-center">
          <Sparkles className="mb-3 size-7 text-muted-foreground" />
          <p className="text-sm font-medium">No proposal yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            The conversation will produce a validated Role and Workflow draft here.
          </p>
          {draft.status === 'draft' && (
            <Button className="mt-4" size="sm" disabled={pending} onClick={loadTemplate}>
              <Sparkles /> Use standard template
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-5 p-4">
          {proposal.issues.length > 0 && <ProposalIssues proposal={proposal} />}
          <section aria-labelledby="generated-roles-title" className="space-y-2">
            <div className="flex items-center gap-2">
              <Users className="size-3.5 text-muted-foreground" />
              <h3 id="generated-roles-title" className="text-xs font-semibold">
                {draft.workflowRevision ? 'New Roles' : 'Generated Roles'}
              </h3>
              <Badge variant="outline">{proposal.roles.length}</Badge>
            </div>
            {draft.workflowRevision && proposal.roles.length === 0 && (
              <p className="text-xs text-muted-foreground">
                This revision reuses existing Role Profiles.
              </p>
            )}
            <div className="space-y-2">
              {proposal.roles.map((role) => (
                <article
                  key={role.id}
                  className="rounded-md border border-border bg-background p-3"
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p data-i18n-skip className="truncate text-sm font-medium">
                        {role.displayName}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                        {role.id}
                      </p>
                    </div>
                    {draft.status === 'draft' && (
                      <MamDesignRoleDialog
                        role={role}
                        snapshot={snapshotWithProposal(snapshot, proposal)}
                        pending={pending}
                        onSave={onUpdateRole}
                      />
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span>{role.execution.executorProfileId}</span>
                    <span>{role.execution.modelProfileId}</span>
                    <span>
                      {role.skillBindings.length +
                        role.mcpBindings.length +
                        role.knowledgeBaseBindings.length}{' '}
                      resources
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </section>
          <section aria-labelledby="generated-workflow-title" className="space-y-2">
            <div className="flex items-center gap-2">
              <Network className="size-3.5 text-muted-foreground" />
              <h3 id="generated-workflow-title" className="text-xs font-semibold">
                {draft.workflowRevision ? 'Workflow Revision' : 'Generated Workflow'}
              </h3>
              {draft.workflowRevision && (
                <Badge variant="outline">v{draft.workflowRevision.nextVersion}</Badge>
              )}
            </div>
            <div className="rounded-md border border-border bg-background p-3">
              <p data-i18n-skip className="break-words text-sm font-medium">
                {proposal.workflow.name}
              </p>
              <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                {proposal.workflow.id}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {proposal.workflow.nodes.map((node) => (
                  <Badge key={node.id} variant="secondary" data-i18n-skip>
                    {node.id} · {node.type.replaceAll('_', ' ')}
                  </Badge>
                ))}
              </div>
              {draft.status === 'draft' && (
                <Button
                  className="mt-3"
                  variant="outline"
                  size="xs"
                  disabled={pending}
                  onClick={onEditWorkflow}
                >
                  <Network /> Inspect in canvas
                </Button>
              )}
            </div>
          </section>
        </div>
      )}
      {proposal && (
        <Dialog open={confirmTemplate} onOpenChange={setConfirmTemplate}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Replace this proposal with the standard template?</DialogTitle>
              <DialogDescription>
                The current unconfirmed Role and Workflow draft will be replaced. The local
                conversation will remain available.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmTemplate(false)}>
                Cancel
              </Button>
              <Button
                disabled={pending}
                onClick={() => {
                  setConfirmTemplate(false)
                  void onCreateTemplate()
                }}
              >
                Load standard template
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </aside>
  )
}

function ProposalState({
  proposal,
  status
}: Readonly<{ proposal: MamDesignProposal; status: MamDesignDraft['status'] }>): React.JSX.Element {
  const errors = proposal.issues.filter((issue) => issue.severity === 'error').length
  if (status === 'applied') {
    return <p className="mt-0.5 text-[11px] text-muted-foreground">Created from this draft</p>
  }
  return (
    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
      {errors > 0 ? (
        <AlertTriangle className="size-3 text-destructive" />
      ) : (
        <CheckCircle2 className="size-3" />
      )}
      {errors > 0 ? `${errors} blocking issues` : 'Validated and ready to confirm'}
    </p>
  )
}

function ProposalIssues({
  proposal
}: Readonly<{ proposal: MamDesignProposal }>): React.JSX.Element {
  return (
    <section aria-label="Proposal issues" className="space-y-2">
      {proposal.issues.map((issue, index) => (
        <div
          key={`${issue.code}:${issue.path ?? ''}:${index}`}
          className={
            issue.severity === 'error'
              ? 'rounded-md border border-destructive p-2 text-xs text-destructive'
              : 'rounded-md border border-border p-2 text-xs text-muted-foreground'
          }
        >
          <p className="mb-1 flex items-center gap-1 font-semibold">
            {issue.severity === 'error' ? <AlertTriangle className="size-3" /> : null}
            {issue.severity === 'error' ? 'Error' : 'Warning'}
          </p>
          <p data-i18n-skip className="break-words">
            {issue.message}
          </p>
          {issue.path && <p className="mt-0.5 break-all font-mono text-[11px]">{issue.path}</p>}
        </div>
      ))}
    </section>
  )
}

function ApplyProposalDialog({
  proposal,
  revision,
  pending,
  onApply
}: Readonly<{
  proposal: MamDesignProposal
  revision?: MamDesignDraft['workflowRevision']
  pending: boolean
  onApply(): Promise<void>
}>): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string>()
  const blocked = proposal.issues.some((issue) => issue.severity === 'error')
  const apply = async (): Promise<void> => {
    setError(undefined)
    try {
      await onApply()
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <>
      <Button size="sm" disabled={pending || blocked} onClick={() => setOpen(true)}>
        <CheckCircle2 /> {revision ? 'Confirm new version' : 'Confirm and create'}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setError(undefined)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {revision ? 'Create this Workflow version?' : 'Create generated definitions?'}
            </DialogTitle>
            <DialogDescription>
              {revision
                ? `This creates ${proposal.workflow.id} version ${proposal.workflow.version}${proposal.roles.length > 0 ? ` and ${proposal.roles.length} new Role Profiles` : ''}. Existing Runs keep their current Workflow version.`
                : `This creates ${proposal.roles.length} new Role Profiles and one new Workflow Definition. It does not start a Run or assign any Tasks.`}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="break-words text-xs text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={pending} onClick={() => void apply()}>
              {revision ? 'Create Workflow version' : 'Create definitions'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function snapshotWithProposal(snapshot: MamUiSnapshot, proposal: MamDesignProposal): MamUiSnapshot {
  return { ...snapshot, roles: [...snapshot.roles, ...proposal.roles] }
}
