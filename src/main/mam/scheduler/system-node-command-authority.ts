import type { WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'

export function assertSystemNodeCommandAuthority(input: {
  command: Extract<SchedulerCommand, { type: 'complete_system_node' }>
  context: Readonly<{
    schedulerId: string
    runBundle?: WorkflowRunBundle
    nodeStatuses?: ReadonlyMap<string, string>
    completedSystemNodeIds?: ReadonlySet<string>
    validArtifactHashes: ReadonlySet<string>
  }>
  reject(code: string, message: string): never
}): void {
  const { command, context } = input
  if (command.actor.kind !== 'scheduler' || command.actor.schedulerId !== context.schedulerId) {
    input.reject('scheduler_authority_required', 'command requires the active Scheduler identity')
  }
  const node = context.runBundle?.definition.nodes.find(
    (candidate) => candidate.id === command.execution.nodeId
  )
  if (!node || (node.type !== 'artifact_transform' && node.type !== 'command')) {
    input.reject('system_node_not_found', 'system node was not found')
  }
  if (node.type !== command.execution.nodeType) {
    input.reject('system_node_type_mismatch', 'system execution targets another node type')
  }
  if (context.completedSystemNodeIds?.has(node.id)) {
    input.reject('system_node_already_completed', 'system node already has an execution')
  }
  if (context.nodeStatuses?.get(node.id) !== 'ready') {
    input.reject('system_node_not_ready', 'system node dependencies are not satisfied')
  }
  if (command.execution.status === 'blocked') return
  if (node.type === 'command' && !command.execution.commandEvidence) {
    input.reject('command_evidence_required', 'command node requires execution evidence')
  }
  const required = node.outputs.filter((contract) => contract.required)
  for (const contract of required) {
    const artifact = command.execution.artifacts.find(
      (candidate) => candidate.artifactType === contract.artifactType
    )
    if (!artifact || !context.validArtifactHashes.has(artifact.contentHash)) {
      input.reject('system_artifact_invalid', 'system node output is missing or unvalidated')
    }
  }
}
