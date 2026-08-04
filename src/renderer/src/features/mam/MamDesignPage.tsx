import { FilePlus2, Settings, Sparkles } from 'lucide-react'
import { useState } from 'react'
import type { RoleProfile } from '../../../../shared/mam/domain/role'
import type { MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import { Button } from '../../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../../components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { MamDesignConversation } from './MamDesignConversation'
import { MamDesignProposalPanel } from './MamDesignProposalPanel'
import { MamDesignRecoveryCard } from './MamDesignRecoveryCard'
import { MamWorkflowEditor } from './MamWorkflowEditor'
import { useMamDesignAssistant } from './use-mam-design-assistant'

export function MamDesignPage({
  snapshot,
  onApplied,
  onOpenSettings
}: Readonly<{
  snapshot: MamUiSnapshot
  onApplied(): void
  onOpenSettings(): void
}>): React.JSX.Element {
  const design = useMamDesignAssistant(onApplied)
  const [editingWorkflow, setEditingWorkflow] = useState(false)
  const models = designModels(snapshot)
  const selectedModelId = models.some((model) => model.id === design.draft?.selectedModelProfileId)
    ? design.draft?.selectedModelProfileId
    : models[0]?.id
  const proposal = design.draft?.proposal
  if (editingWorkflow && proposal) {
    return (
      <MamWorkflowEditor
        workflow={proposal.workflow}
        roles={proposal.roles}
        pending={false}
        saveLabel="Save draft"
        versionLabel="unconfirmed draft"
        onClose={() => setEditingWorkflow(false)}
        onSave={async ({ definition }) => {
          await design.updateProposal({
            expectedProposalHash: proposal.hash,
            roles: proposal.roles,
            workflow: definition
          })
          setEditingWorkflow(false)
        }}
      />
    )
  }
  if (!design.draft || design.loading) {
    return (
      <div className="flex min-h-full items-center justify-center text-sm text-muted-foreground">
        Loading Design draft…
      </div>
    )
  }
  if (models.length === 0) {
    return (
      <section className="flex min-h-full flex-col items-center justify-center p-8 text-center">
        <Sparkles className="mb-3 size-7 text-muted-foreground" />
        <h1 className="text-sm font-semibold">No compatible Model Profile</h1>
        <p className="mt-1 max-w-md text-xs text-muted-foreground">
          Add a direct model connection with structured output before starting a Design draft.
        </p>
        {design.draft?.recovery && (
          <div className="mt-4 w-full max-w-lg text-left">
            <MamDesignRecoveryCard
              recovery={design.draft.recovery}
              pending
              onRetry={async () => undefined}
              onTemplate={async () => undefined}
            />
          </div>
        )}
        <Button className="mt-4" size="sm" onClick={onOpenSettings}>
          <Settings /> Open Settings
        </Button>
      </section>
    )
  }
  const activeModelId = selectedModelId ?? models[0]!.id
  const draft = design.draft
  const pending = design.sending || design.creatingTemplate || design.applying
  return (
    <section className="flex h-full min-h-0 flex-col" aria-labelledby="design-title">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2">
        <div className="mr-auto min-w-0">
          <h1 id="design-title" className="text-sm font-semibold">
            Design Assistant
          </h1>
          <p className="text-xs text-muted-foreground">Local draft · not part of Workflow state</p>
        </div>
        <Select
          value={activeModelId}
          disabled={pending || draft.status === 'applied'}
          onValueChange={(modelProfileId) => void design.selectModel(modelProfileId)}
        >
          <SelectTrigger className="w-64" aria-label="Design model">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {models.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <NewDesignDialog
          disabled={pending}
          hasContent={draft.messages.length > 0 || Boolean(draft.proposal)}
          onReset={() => design.reset(activeModelId)}
        />
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
        <MamDesignConversation
          messages={draft.messages}
          sending={design.sending}
          disabled={draft.status === 'applied'}
          {...(design.error ? { error: design.error } : {})}
          onSend={(message) => design.sendMessage(message, activeModelId)}
          onCancel={design.cancelMessage}
        />
        <MamDesignProposalPanel
          draft={draft}
          snapshot={snapshot}
          pending={pending}
          onEditWorkflow={() => setEditingWorkflow(true)}
          onUpdateRole={(role) => updateRole(design.updateProposal, draft, role)}
          onApply={() => design.applyProposal(draft.proposal!.hash)}
          onCreateTemplate={() => design.createTemplate(activeModelId)}
          onRetry={design.retryGeneration}
        />
      </div>
    </section>
  )
}

function NewDesignDialog({
  disabled,
  hasContent,
  onReset
}: Readonly<{
  disabled: boolean
  hasContent: boolean
  onReset(): Promise<void>
}>): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const reset = async (): Promise<void> => {
    await onReset()
    setOpen(false)
  }
  if (!hasContent) {
    return (
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => void onReset()}>
        <FilePlus2 /> New Design
      </Button>
    )
  }
  return (
    <>
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => setOpen(true)}>
        <FilePlus2 /> New Design
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard this Design draft?</DialogTitle>
            <DialogDescription>
              The local conversation and unconfirmed proposal will be removed. Created definitions
              are not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void reset()}>Discard and start new</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

async function updateRole(
  updateProposal: ReturnType<typeof useMamDesignAssistant>['updateProposal'],
  draft: NonNullable<ReturnType<typeof useMamDesignAssistant>['draft']>,
  role: RoleProfile
): Promise<void> {
  const proposal = draft.proposal!
  await updateProposal({
    expectedProposalHash: proposal.hash,
    roles: proposal.roles.map((candidate) => (candidate.id === role.id ? role : candidate)),
    workflow: proposal.workflow
  })
}

function designModels(snapshot: MamUiSnapshot) {
  return snapshot.models.filter((model) => {
    const provider = snapshot.providers.find(
      (candidate) => candidate.id === model.providerProfileId
    )
    return (
      provider &&
      provider.protocol !== 'executor-native' &&
      model.capabilities.supportsStructuredOutput
    )
  })
}
