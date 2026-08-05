import type { WorkflowDefinition } from '../../../../shared/mam/domain/workflow'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'

const ALL_ROLES_VALUE = 'all'
const WORKFLOW_VALUE_PREFIX = 'workflow:'

export function MamWorkflowRoleFilter({
  workflows,
  workflow,
  onChange
}: Readonly<{
  workflows: readonly WorkflowDefinition[]
  workflow: WorkflowDefinition | undefined
  onChange(workflowId?: string): void
}>): React.JSX.Element {
  return (
    <Select
      value={workflow ? workflowSelectValue(workflow.id) : ALL_ROLES_VALUE}
      onValueChange={(value) =>
        onChange(value === ALL_ROLES_VALUE ? undefined : value.slice(WORKFLOW_VALUE_PREFIX.length))
      }
    >
      <SelectTrigger className="w-56" aria-label="Filter Roles by Workflow">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value={ALL_ROLES_VALUE}>All Roles</SelectItem>
        {workflows.map((candidate) => (
          <SelectItem key={candidate.id} value={workflowSelectValue(candidate.id)}>
            {candidate.name} · v{candidate.version}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function workflowSelectValue(workflowId: string): string {
  return `${WORKFLOW_VALUE_PREFIX}${workflowId}`
}
