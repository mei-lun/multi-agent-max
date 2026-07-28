import type { RoleProfile } from '../../../../shared/mam/domain/role'
import type { WorkflowNode } from '../../../../shared/mam/domain/workflow'
import { Input } from '../../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { Textarea } from '../../components/ui/textarea'
import {
  MamWorkflowArtifactContractList,
  MamWorkflowArtifactRefList
} from './MamWorkflowArtifactFields'
import {
  MamWorkflowLabeledField,
  MamWorkflowNumberField,
  MamWorkflowStringListField
} from './MamWorkflowFieldControls'
import { MamWorkflowRoleSelectionFields } from './MamWorkflowRoleSelectionFields'

type RoleNode = Extract<
  WorkflowNode,
  { type: 'role_task' | 'dynamic_tasks' | 'review_gate' | 'git_merge' }
>

export function MamWorkflowRoleNodeFields({
  node,
  roles,
  onChange
}: Readonly<{
  node: RoleNode
  roles: readonly RoleProfile[]
  onChange(node: RoleNode): void
}>): React.JSX.Element {
  const roleFields = (
    <MamWorkflowRoleSelectionFields
      roles={roles}
      recommendedRoleProfileIds={node.recommendedRoleProfileIds}
      allowedRoleProfileIds={node.allowedRoleProfileIds}
      onChange={(selection) => onChange({ ...node, ...selection })}
    />
  )
  if (node.type === 'role_task') {
    return (
      <div className="space-y-3">
        {roleFields}
        <MamWorkflowLabeledField label="Instruction">
          <Textarea
            className="min-h-28"
            value={node.instruction}
            onChange={(event) => onChange({ ...node, instruction: event.target.value })}
          />
        </MamWorkflowLabeledField>
        <MamWorkflowLabeledField label="Workspace access">
          <Select
            value={node.workspaceMode}
            onValueChange={(workspaceMode) =>
              onChange({ ...node, workspaceMode: workspaceMode as typeof node.workspaceMode })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="read">Read only</SelectItem>
              <SelectItem value="write">Write</SelectItem>
            </SelectContent>
          </Select>
        </MamWorkflowLabeledField>
        <MamWorkflowArtifactRefList
          label="Input Artifacts"
          references={node.inputs}
          onChange={(inputs) => onChange({ ...node, inputs })}
        />
        <MamWorkflowArtifactContractList
          label="Output Artifact contracts"
          contracts={node.outputs}
          minimum={1}
          onChange={(outputs) => onChange({ ...node, outputs })}
        />
      </div>
    )
  }
  if (node.type === 'dynamic_tasks') {
    return (
      <div className="space-y-3">
        {roleFields}
        <MamWorkflowNumberField
          label="Maximum generated tasks"
          minimum={1}
          value={node.maxTasks}
          onChange={(maxTasks) => onChange({ ...node, maxTasks })}
        />
        <MamWorkflowArtifactContractList
          label="Task plan contract"
          contracts={[node.planContract]}
          minimum={1}
          onChange={([planContract]) => {
            if (planContract) onChange({ ...node, planContract })
          }}
        />
      </div>
    )
  }
  if (node.type === 'review_gate') {
    return (
      <div className="space-y-3">
        {roleFields}
        <div className="grid grid-cols-2 gap-2">
          <MamWorkflowNumberField
            label="Minimum decisions"
            minimum={1}
            value={node.minimumDecisions}
            onChange={(minimumDecisions) => onChange({ ...node, minimumDecisions })}
          />
          <MamWorkflowNumberField
            label="Max revision Attempts"
            minimum={1}
            value={node.maxRevisionAttempts}
            onChange={(maxRevisionAttempts) => onChange({ ...node, maxRevisionAttempts })}
          />
        </div>
        <MamWorkflowArtifactRefList
          label="Review subjects"
          references={node.inputs}
          minimum={1}
          onChange={(inputs) => onChange({ ...node, inputs })}
        />
        <MamWorkflowArtifactContractList
          label="Review report contract"
          contracts={[node.reportContract]}
          minimum={1}
          onChange={([reportContract]) => {
            if (reportContract) onChange({ ...node, reportContract })
          }}
        />
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {roleFields}
      <MamWorkflowLabeledField label="Target branch">
        <Input
          value={node.targetBranch}
          onChange={(event) => onChange({ ...node, targetBranch: event.target.value })}
        />
      </MamWorkflowLabeledField>
      <MamWorkflowLabeledField label="Merge strategy">
        <Select
          value={node.strategy}
          onValueChange={(strategy) =>
            onChange({ ...node, strategy: strategy as typeof node.strategy })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="no_ff">Create merge commit</SelectItem>
            <SelectItem value="ff_only">Fast-forward only</SelectItem>
          </SelectContent>
        </Select>
      </MamWorkflowLabeledField>
      <div className="rounded-md border border-border p-3 text-xs text-muted-foreground">
        Queue order is fixed to merge-ready time. Conflicts create a coordinator Attempt.
      </div>
      <MamWorkflowStringListField
        label="Post-merge validations"
        description="One command per line. Commands run in order after integration."
        values={node.validations}
        onChange={(validations) => onChange({ ...node, validations })}
      />
    </div>
  )
}
