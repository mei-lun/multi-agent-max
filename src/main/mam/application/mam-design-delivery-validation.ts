import type { MamDesignValidationIssue } from '../../../shared/mam/design-assistant'
import type { WorkflowDefinition, WorkflowNode } from '../../../shared/mam/domain/workflow'

export function validateMamDesignDelivery(
  workflow: WorkflowDefinition
): MamDesignValidationIssue[] {
  return workflow.nodes
    .filter((node) => node.type === 'role_task' && node.workspaceMode === 'write')
    .filter((node) => !hasReleasePath(workflow, node.id))
    .map((node) => ({
      code: 'write_delivery_route_required',
      severity: 'error' as const,
      message: [
        `Write node ${node.id} must reach Review, git_merge to develop,`,
        'an approval gate, git_merge to main, and finish in that order.'
      ].join(' '),
      path: `workflow.nodes.${node.id}`
    }))
}

function hasReleasePath(workflow: WorkflowDefinition, sourceNodeId: string): boolean {
  const successors = new Map<string, string[]>()
  for (const edge of workflow.edges) {
    successors.set(edge.from, [...(successors.get(edge.from) ?? []), edge.to])
  }
  const nodes = new Map(workflow.nodes.map((node) => [node.id, node]))
  const pending = (successors.get(sourceNodeId) ?? []).map((nodeId) => ({ nodeId, stage: 0 }))
  const visited = new Set<string>()
  while (pending.length > 0) {
    const current = pending.shift()!
    const key = `${current.nodeId}:${current.stage}`
    if (visited.has(key)) continue
    visited.add(key)
    const node = nodes.get(current.nodeId)
    if (!node) continue
    const stage = releaseStage(node, current.stage)
    if (node.type === 'finish' && stage === 4) return true
    for (const successor of successors.get(node.id) ?? [])
      pending.push({ nodeId: successor, stage })
  }
  return false
}

function releaseStage(node: WorkflowNode, stage: number): number {
  if (stage === 0 && node.type === 'review_gate') return 1
  if (stage === 1 && node.type === 'git_merge' && node.targetBranch === 'develop') return 2
  if (stage === 2 && node.type === 'approval_gate') return 3
  if (stage === 3 && node.type === 'git_merge' && node.targetBranch === 'main') return 4
  return stage
}
