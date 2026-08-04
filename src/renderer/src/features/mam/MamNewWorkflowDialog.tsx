import { FilePlus2 } from 'lucide-react'
import { useState } from 'react'
import type { WorkflowDefinition } from '../../../../shared/mam/domain/workflow'
import { MamEntityIdSchema } from '../../../../shared/mam/domain/primitives'
import type { RoleProfile } from '../../../../shared/mam/domain/role'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { MamWorkflowLabeledField } from './MamWorkflowFieldControls'

export type MamWorkflowStarter = 'delivery' | 'blank'

export const DEFAULT_MAM_WORKFLOW_STARTER: MamWorkflowStarter = 'delivery'

export function MamNewWorkflowDialog({
  existingIds,
  roles,
  open: controlledOpen,
  onOpenChange,
  onCreate
}: Readonly<{
  existingIds: readonly string[]
  roles: readonly RoleProfile[]
  open?: boolean
  onOpenChange?(open: boolean): void
  onCreate(definition: WorkflowDefinition): void
}>): React.JSX.Element {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const changeOpen = (next: boolean): void => {
    setInternalOpen(next)
    onOpenChange?.(next)
  }
  const [id, setId] = useState('workflow.new')
  const [name, setName] = useState('New workflow')
  const [starter, setStarter] = useState<MamWorkflowStarter>(DEFAULT_MAM_WORKFLOW_STARTER)
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
    onCreate(newWorkflowDefinitionForStarter(starter, parsedId.data, name.trim(), roles))
    changeOpen(false)
    setError(undefined)
  }
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <FilePlus2 /> New Workflow
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Workflow Definition</DialogTitle>
          <DialogDescription>
            Start with a complete delivery path, or choose a blank graph for advanced workflows.
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
          <MamWorkflowLabeledField label="Starter">
            <Select value={starter} onValueChange={(value) => setStarter(value as typeof starter)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="delivery">Reviewed delivery (recommended)</SelectItem>
                <SelectItem value="blank">Blank graph (advanced)</SelectItem>
              </SelectContent>
            </Select>
          </MamWorkflowLabeledField>
          {starter === 'delivery' && roles.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Create Role Profiles before running this Workflow; the graph can still be saved now.
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => changeOpen(false)}>
            Cancel
          </Button>
          <Button onClick={create}>Open editor</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function newDeliveryWorkflowDefinition(
  id: string,
  name: string,
  roles: readonly RoleProfile[]
): WorkflowDefinition {
  const author = roles.find((role) => role.permissions.writePaths.length > 0) ?? roles[0]
  const reviewer = roles.find((role) => role.id !== author?.id) ?? author
  const authorIds = author ? [author.id] : []
  const reviewerIds = reviewer ? [reviewer.id] : []
  const outputRef = {
    artifactId: 'artifact.delivery-files',
    version: 1,
    contentHash: '0'.repeat(64)
  }
  return {
    schemaVersion: '1.0.0',
    id,
    name,
    version: 1,
    nodes: [
      {
        id: 'create-delivery',
        type: 'role_task',
        recommendedRoleProfileIds: authorIds,
        allowedRoleProfileIds: authorIds,
        instruction: 'Create the requested delivery and verify the result.',
        workspaceMode: 'write',
        inputs: [],
        outputs: [
          {
            schemaVersion: '1.0.0',
            artifactType: 'artifact.delivery-files',
            format: 'file-set',
            required: true,
            maxBytes: 10_000_000,
            allowedGlobs: ['**/*']
          }
        ]
      },
      {
        id: 'review-delivery',
        type: 'review_gate',
        recommendedRoleProfileIds: reviewerIds,
        allowedRoleProfileIds: reviewerIds,
        inputs: [outputRef],
        reportContract: {
          schemaVersion: '1.0.0',
          artifactType: 'artifact.review-report',
          format: 'json-schema',
          required: true,
          maxBytes: 100_000,
          jsonSchema: { type: 'object' }
        },
        minimumDecisions: 1,
        maxRevisionAttempts: 2
      },
      mergeNode('integrate-develop', 'develop', authorIds),
      {
        id: 'approve-release',
        type: 'approval_gate',
        prompt: 'The reviewed result is available on develop. Promote it to main?',
        options: ['Promote to main']
      },
      mergeNode('promote-main', 'main', authorIds),
      { id: 'finish', type: 'finish', inputs: [outputRef] }
    ],
    edges: [
      { from: 'create-delivery', to: 'review-delivery' },
      { from: 'review-delivery', to: 'integrate-develop' },
      { from: 'integrate-develop', to: 'approve-release' },
      { from: 'approve-release', to: 'promote-main' },
      { from: 'promote-main', to: 'finish' }
    ],
    maxTransitions: 100,
    maxRunCostUsd: 10,
    maxRunDurationSeconds: 3600
  }
}

export function newWorkflowDefinitionForStarter(
  starter: MamWorkflowStarter,
  id: string,
  name: string,
  roles: readonly RoleProfile[]
): WorkflowDefinition {
  return starter === 'delivery'
    ? newDeliveryWorkflowDefinition(id, name, roles)
    : newWorkflowDefinition(id, name)
}

function mergeNode(
  id: string,
  targetBranch: string,
  roleProfileIds: string[]
): Extract<WorkflowDefinition['nodes'][number], { type: 'git_merge' }> {
  return {
    id,
    type: 'git_merge',
    recommendedRoleProfileIds: roleProfileIds,
    allowedRoleProfileIds: roleProfileIds,
    targetBranch,
    orderBy: 'merge_ready_at',
    strategy: 'no_ff',
    conflictPolicy: 'coordinator_attempt',
    validations: []
  }
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
