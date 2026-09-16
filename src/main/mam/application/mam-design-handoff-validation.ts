import type { MamDesignValidationIssue } from '../../../shared/mam/design-assistant'
import type { WorkflowDefinition, WorkflowNode } from '../../../shared/mam/domain/workflow'

export function validateMamDesignHandoffs(
  workflow: WorkflowDefinition
): MamDesignValidationIssue[] {
  const issues: MamDesignValidationIssue[] = []
  for (const consumer of workflow.nodes.filter((node) => node.type === 'role_task')) {
    for (const input of consumer.inputs) {
      const producers = workflow.nodes.filter(
        (node) =>
          node.type === 'role_task' &&
          node.outputs.some((output) => output.artifactType === input.artifactId) &&
          isReachable(workflow, node.id, consumer.id)
      )
      if (producers.length > 1) {
        issues.push(
          issue(
            'role_handoff_artifact_ambiguous',
            `Role node ${consumer.id} has multiple upstream producers for ${input.artifactId}.`,
            consumer.id
          )
        )
        continue
      }
      const producer = producers[0]
      if (!producer || producer.type !== 'role_task') continue
      if (producer.workspaceMode !== 'write') {
        issues.push(
          issue(
            'role_handoff_write_workspace_required',
            `Role node ${producer.id} must use workspaceMode write so ${input.artifactId} can be integrated for ${consumer.id}.`,
            producer.id
          )
        )
      }
      if (!hasReviewedIntegrationPath(workflow, producer.id, consumer.id)) {
        issues.push(
          issue(
            'role_handoff_integration_required',
            `Artifact ${input.artifactId} must pass through Review and git_merge before Role node ${consumer.id} starts.`,
            consumer.id
          )
        )
      }
    }
  }
  return issues
}

function hasReviewedIntegrationPath(
  workflow: WorkflowDefinition,
  producerId: string,
  consumerId: string
): boolean {
  const nodes = new Map(workflow.nodes.map((node) => [node.id, node]))
  const successors = successorMap(workflow)
  const pending = (successors.get(producerId) ?? []).map((nodeId) => ({ nodeId, stage: 0 }))
  const visited = new Set<string>()
  while (pending.length > 0) {
    const current = pending.shift()!
    const key = `${current.nodeId}:${current.stage}`
    if (visited.has(key)) continue
    visited.add(key)
    const node = nodes.get(current.nodeId)
    if (!node) continue
    if (node.id !== consumerId && (node.type === 'role_task' || node.type === 'dynamic_tasks')) {
      continue
    }
    const stage = handoffStage(node, current.stage)
    if (node.id === consumerId && stage === 2) return true
    for (const successor of successors.get(node.id) ?? []) {
      pending.push({ nodeId: successor, stage })
    }
  }
  return false
}

function handoffStage(node: WorkflowNode, stage: number): number {
  if (stage === 0 && node.type === 'review_gate') return 1
  if (stage === 1 && node.type === 'git_merge') return 2
  return stage
}

function isReachable(workflow: WorkflowDefinition, sourceId: string, targetId: string): boolean {
  const successors = successorMap(workflow)
  const visited = new Set<string>()
  const pending = [...(successors.get(sourceId) ?? [])]
  while (pending.length > 0) {
    const current = pending.shift()!
    if (current === targetId) return true
    if (visited.has(current)) continue
    visited.add(current)
    pending.push(...(successors.get(current) ?? []))
  }
  return false
}

function successorMap(workflow: WorkflowDefinition): ReadonlyMap<string, readonly string[]> {
  const successors = new Map<string, string[]>()
  for (const edge of workflow.edges) {
    successors.set(edge.from, [...(successors.get(edge.from) ?? []), edge.to])
  }
  return successors
}

function issue(code: string, message: string, nodeId: string): MamDesignValidationIssue {
  return { code, severity: 'error', message, path: `workflow.nodes.${nodeId}` }
}
