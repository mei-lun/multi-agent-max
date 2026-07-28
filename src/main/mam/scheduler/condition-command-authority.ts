import type { WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'

export function assertConditionCommandAuthority(input: {
  command: Extract<SchedulerCommand, { type: 'resolve_condition' }>
  context: Readonly<{
    schedulerId: string
    runBundle?: WorkflowRunBundle
    resolvedConditionNodeIds?: ReadonlySet<string>
    nodeStatuses?: ReadonlyMap<string, string>
  }>
  reject(code: string, message: string): never
}): void {
  const { command } = input
  if (
    command.actor.kind !== 'scheduler' ||
    command.actor.schedulerId !== input.context.schedulerId
  ) {
    input.reject('scheduler_authority_required', 'command requires the active Scheduler identity')
  }
  const node = input.context.runBundle?.definition.nodes.find(
    (candidate) => candidate.id === command.nodeId
  )
  if (!node || node.type !== 'condition') {
    input.reject('condition_node_not_found', 'condition node was not found')
  }
  if (input.context.resolvedConditionNodeIds?.has(command.nodeId)) {
    input.reject('condition_already_resolved', 'condition has already selected a branch')
  }
  if (!Object.hasOwn(node.branches, command.selectedBranch)) {
    input.reject('condition_branch_not_found', 'condition branch is not declared by the node')
  }
  if (input.context.nodeStatuses?.get(command.nodeId) !== 'ready') {
    input.reject('condition_not_ready', 'condition dependencies are not satisfied')
  }
}
