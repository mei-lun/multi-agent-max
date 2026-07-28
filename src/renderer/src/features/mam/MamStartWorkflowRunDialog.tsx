import { Play } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import type { MamCreateWorkflowRunInput } from '../../../../shared/mam/application-command'
import { ArtifactRefSchema } from '../../../../shared/mam/domain/artifact'
import type { WorkflowDefinition } from '../../../../shared/mam/domain/workflow'
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
import { Textarea } from '../../components/ui/textarea'
import { MamWorkflowLabeledField } from './MamWorkflowFieldControls'

const InputArtifactsSchema = z.array(ArtifactRefSchema)

export function MamStartWorkflowRunDialog({
  workflow,
  disabled,
  onCreate
}: Readonly<{
  workflow: WorkflowDefinition
  disabled: boolean
  onCreate(input: MamCreateWorkflowRunInput): Promise<void>
}>): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState('[]')
  const [error, setError] = useState<string>()
  const create = async (): Promise<void> => {
    try {
      const inputArtifacts = InputArtifactsSchema.parse(JSON.parse(source))
      await onCreate({
        definitionId: workflow.id,
        definitionVersion: workflow.version,
        inputArtifacts
      })
      setOpen(false)
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="xs" disabled={disabled}>
          <Play /> Start Run
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Start Workflow Run</DialogTitle>
          <DialogDescription>
            Freeze {workflow.name} v{workflow.version}, active referenced Roles, and input Artifact
            versions into Git-backed Run state.
          </DialogDescription>
        </DialogHeader>
        <MamWorkflowLabeledField
          label="Input Artifacts"
          description="JSON array of immutable Artifact references. Use [] when the graph has no external inputs."
        >
          <Textarea
            className="min-h-40 font-mono text-xs"
            value={source}
            onChange={(event) => setSource(event.target.value)}
          />
        </MamWorkflowLabeledField>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => void create()}>Create Git-backed Run</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
