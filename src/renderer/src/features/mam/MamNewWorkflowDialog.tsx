import { FilePlus2 } from 'lucide-react'
import { useState } from 'react'
import type { WorkflowDefinition } from '../../../../shared/mam/domain/workflow'
import { MamEntityIdSchema } from '../../../../shared/mam/domain/primitives'
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
import { Input } from '../../components/ui/input'
import { MamWorkflowLabeledField } from './MamWorkflowFieldControls'

export function MamNewWorkflowDialog({
  existingIds,
  onCreate
}: Readonly<{
  existingIds: readonly string[]
  onCreate(definition: WorkflowDefinition): void
}>): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [id, setId] = useState('workflow.new')
  const [name, setName] = useState('New workflow')
  const [error, setError] = useState<string>()
  const create = (): void => {
    const parsedId = MamEntityIdSchema.safeParse(id.trim())
    if (!parsedId.success) {
      setError('Use 1–128 letters, numbers, dots, underscores, colons, or hyphens.')
      return
    }
    if (existingIds.includes(parsedId.data)) {
      setError('A Workflow Definition with this ID already exists.')
      return
    }
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    onCreate(newWorkflowDefinition(parsedId.data, name.trim()))
    setOpen(false)
    setError(undefined)
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <FilePlus2 /> New Workflow
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Workflow Definition</DialogTitle>
          <DialogDescription>
            Start with a finish node, then build the versioned graph on the visual canvas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <MamWorkflowLabeledField label="Definition ID">
            <Input
              className="font-mono"
              value={id}
              onChange={(event) => setId(event.target.value)}
            />
          </MamWorkflowLabeledField>
          <MamWorkflowLabeledField label="Name">
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </MamWorkflowLabeledField>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={create}>Open editor</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function newWorkflowDefinition(id: string, name: string): WorkflowDefinition {
  return {
    schemaVersion: '1.0.0',
    id,
    name,
    version: 1,
    nodes: [{ id: 'finish', type: 'finish', inputs: [] }],
    edges: [],
    maxTransitions: 100,
    maxRunCostUsd: 10,
    maxRunDurationSeconds: 3600
  }
}
