import { useEffect, useState } from 'react'
import type { WorkflowNode } from '../../../../shared/mam/domain/workflow'
import { Input } from '../../components/ui/input'
import { Textarea } from '../../components/ui/textarea'
import {
  MamWorkflowArtifactContractList,
  MamWorkflowArtifactRefList
} from './MamWorkflowArtifactFields'
import { MamWorkflowLabeledField, MamWorkflowStringListField } from './MamWorkflowFieldControls'
import { MamWorkflowDataContractDetails } from './MamWorkflowDataContractDetails'

type SystemNode = Exclude<WorkflowNode, { recommendedRoleProfileIds: string[] }>

export function MamWorkflowSystemNodeFields({
  node,
  onChange
}: Readonly<{
  node: SystemNode
  onChange(node: SystemNode): void
}>): React.JSX.Element {
  if (node.type === 'approval_gate') {
    return (
      <div className="space-y-3">
        <MamWorkflowLabeledField label="Approval prompt">
          <Textarea
            value={node.prompt}
            onChange={(event) => onChange({ ...node, prompt: event.target.value })}
          />
        </MamWorkflowLabeledField>
        <MamWorkflowStringListField
          label="Decision options"
          values={node.options}
          onChange={(options) => onChange({ ...node, options })}
        />
      </div>
    )
  }
  if (node.type === 'human_review_gate') {
    return (
      <div className="space-y-3">
        <MamWorkflowLabeledField label="Review instructions">
          <Textarea
            value={node.instructions}
            onChange={(event) => onChange({ ...node, instructions: event.target.value })}
          />
        </MamWorkflowLabeledField>
        <MamWorkflowLabeledField
          label="Revision target node ID"
          description="Defaults to the role_task that produced the reviewed Artifact."
        >
          <Input
            className="font-mono"
            value={node.revisionTargetNodeId}
            onChange={(event) => onChange({ ...node, revisionTargetNodeId: event.target.value })}
          />
        </MamWorkflowLabeledField>
        <MamWorkflowLabeledField label="Maximum revision Attempts">
          <Input
            type="number"
            min={1}
            max={20}
            value={node.maxRevisionAttempts}
            onChange={(event) =>
              onChange({ ...node, maxRevisionAttempts: Number(event.target.value) })
            }
          />
        </MamWorkflowLabeledField>
        <MamWorkflowDataContractDetails>
          <MamWorkflowArtifactRefList
            label="Artifacts to review"
            references={node.inputs}
            minimum={1}
            onChange={(inputs) => onChange({ ...node, inputs })}
          />
        </MamWorkflowDataContractDetails>
      </div>
    )
  }
  if (node.type === 'condition') {
    return (
      <div className="space-y-3">
        <MamWorkflowLabeledField label="Condition expression">
          <Textarea
            className="font-mono"
            value={node.expression}
            onChange={(event) => onChange({ ...node, expression: event.target.value })}
          />
        </MamWorkflowLabeledField>
        <BranchMapField
          value={node.branches}
          onChange={(branches) => onChange({ ...node, branches })}
        />
      </div>
    )
  }
  if (node.type === 'parallel') {
    return (
      <MamWorkflowStringListField
        label="Branch node IDs"
        description="At least two branches, one node ID per line."
        values={node.branches}
        onChange={(branches) => onChange({ ...node, branches })}
      />
    )
  }
  if (node.type === 'join') {
    return (
      <MamWorkflowStringListField
        label="Wait-for node IDs"
        description="At least two branch node IDs, one per line."
        values={node.waitFor}
        onChange={(waitFor) => onChange({ ...node, waitFor })}
      />
    )
  }
  if (node.type === 'artifact_transform') {
    return (
      <div className="space-y-3">
        <MamWorkflowLabeledField label="Transform">
          <Textarea
            className="min-h-24 font-mono"
            value={node.transform}
            onChange={(event) => onChange({ ...node, transform: event.target.value })}
          />
        </MamWorkflowLabeledField>
        <MamWorkflowDataContractDetails>
          <MamWorkflowArtifactRefList
            label="Input Artifacts"
            references={node.inputs}
            minimum={1}
            onChange={(inputs) => onChange({ ...node, inputs })}
          />
          <MamWorkflowArtifactContractList
            label="Output Artifact contracts"
            contracts={node.outputs}
            minimum={1}
            onChange={(outputs) => onChange({ ...node, outputs })}
          />
        </MamWorkflowDataContractDetails>
      </div>
    )
  }
  if (node.type === 'command') {
    return (
      <div className="space-y-3">
        <MamWorkflowLabeledField label="Executable">
          <Input
            className="font-mono"
            value={node.executable}
            onChange={(event) => onChange({ ...node, executable: event.target.value })}
          />
        </MamWorkflowLabeledField>
        <MamWorkflowStringListField
          label="Arguments"
          description="One argument per line; no shell splitting is applied."
          values={node.arguments}
          onChange={(arguments_) => onChange({ ...node, arguments: arguments_ })}
        />
        <MamWorkflowLabeledField label="Working directory">
          <Input
            className="font-mono"
            value={node.workingDirectory}
            onChange={(event) => onChange({ ...node, workingDirectory: event.target.value })}
          />
        </MamWorkflowLabeledField>
        <MamWorkflowDataContractDetails>
          <MamWorkflowArtifactContractList
            label="Output Artifact contracts"
            contracts={node.outputs}
            onChange={(outputs) => onChange({ ...node, outputs })}
          />
        </MamWorkflowDataContractDetails>
      </div>
    )
  }
  return (
    <MamWorkflowDataContractDetails>
      <MamWorkflowArtifactRefList
        label="Completion inputs"
        references={node.inputs}
        onChange={(inputs) => onChange({ ...node, inputs })}
      />
    </MamWorkflowDataContractDetails>
  )
}

function BranchMapField({
  value,
  onChange
}: Readonly<{
  value: Record<string, string>
  onChange(value: Record<string, string>): void
}>): React.JSX.Element {
  const [source, setSource] = useState(formatBranches(value))
  const [error, setError] = useState<string>()
  useEffect(() => {
    setSource(formatBranches(value))
    setError(undefined)
  }, [value])
  const apply = (): void => {
    try {
      onChange(parseBranches(source))
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <MamWorkflowLabeledField label="Branches" description="One result=node-id mapping per line.">
      <Textarea
        className="min-h-24 font-mono"
        value={source}
        aria-invalid={Boolean(error)}
        onChange={(event) => setSource(event.target.value)}
        onBlur={apply}
      />
      {error && <span className="block text-xs text-destructive">{error}</span>}
    </MamWorkflowLabeledField>
  )
}

function formatBranches(value: Record<string, string>): string {
  return Object.entries(value)
    .map(([condition, nodeId]) => `${condition}=${nodeId}`)
    .join('\n')
}

function parseBranches(source: string): Record<string, string> {
  return Object.fromEntries(
    source
      .split(/\r?\n/u)
      .filter((line) => line.trim())
      .map((line) => {
        const separator = line.indexOf('=')
        if (separator <= 0 || !line.slice(separator + 1).trim())
          throw new Error(`Invalid branch mapping: ${line}`)
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()]
      })
  )
}
