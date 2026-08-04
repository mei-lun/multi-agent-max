import { CheckCircle2, Loader2, Play } from 'lucide-react'
import { useState } from 'react'
import type {
  MamCreateWorkflowRunInput,
  MamSaveLocalSettingsInput
} from '../../../../shared/mam/application-command'
import type { MamLocalSettings } from '../../../../shared/mam/local-settings'
import type { WorkflowDefinition } from '../../../../shared/mam/domain/workflow'
import type { MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import { Button } from '../../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '../../components/ui/dialog'
import { workflowExternalArtifactRefs } from './mam-workflow-external-artifacts'
import { activateMamLocalCollaboration } from './mam-local-collaboration-settings'

export function MamStartWorkflowRunDialog({
  workflow,
  existingRunIds,
  localSettings,
  disabled,
  onCreate,
  onSaveLocalSettings
}: Readonly<{
  workflow: WorkflowDefinition
  existingRunIds: readonly string[]
  localSettings: MamLocalSettings
  disabled: boolean
  onCreate(input: MamCreateWorkflowRunInput): Promise<MamUiSnapshot>
  onSaveLocalSettings(input: MamSaveLocalSettingsInput): Promise<void>
}>): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()
  const inputArtifacts = workflowExternalArtifactRefs(workflow)
  const create = async (): Promise<void> => {
    setSubmitting(true)
    setError(undefined)
    try {
      const snapshot = await onCreate({
        definitionId: workflow.id,
        definitionVersion: workflow.version,
        inputArtifacts: [...inputArtifacts]
      })
      const run = snapshot.runs.find(
        (candidate) =>
          !existingRunIds.includes(candidate.run.id) &&
          candidate.run.definitionId === workflow.id &&
          candidate.run.definitionVersion === workflow.version
      )
      if (!run) throw new Error('The new Run could not be identified for local collaboration.')
      await onSaveLocalSettings({
        settings: activateMamLocalCollaboration({ settings: localSettings, run })
      })
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) setError(undefined)
      }}
    >
      <DialogTrigger asChild>
        <Button size="xs" disabled={disabled}>
          <Play /> Start Run
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Start Workflow Run</DialogTitle>
          <DialogDescription>
            Start {workflow.name} v{workflow.version}. MAM will activate its Roles on this machine,
            complete each Task, and pause only when your decision is required.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="size-4 text-primary" /> Ready to start
          </p>
          {inputArtifacts.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              This Workflow does not need external input Artifacts.
            </p>
          ) : (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-muted-foreground">
                {inputArtifacts.length} configured external input versions will be frozen:
              </p>
              {inputArtifacts.map((artifact) => (
                <div
                  key={`${artifact.artifactId}:${artifact.version}:${artifact.contentHash}`}
                  className="flex items-center justify-between rounded-md bg-card px-2 py-1.5 text-xs"
                >
                  <span>{artifact.artifactId}</span>
                  <span className="text-muted-foreground">v{artifact.version}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <details className="text-xs text-muted-foreground">
          <summary className="w-fit cursor-pointer hover:text-foreground">
            Why are versions frozen?
          </summary>
          <p className="mt-2 leading-5">
            A Run keeps exact Role and Artifact versions so its results can be reproduced and
            reviewed later. You do not need to enter JSON.
          </p>
        </details>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={submitting} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={submitting} onClick={() => void create()}>
            {submitting ? <Loader2 className="animate-spin" /> : <Play />}
            Start and complete locally
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
