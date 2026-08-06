import type { WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'
import type { NodeRun, WorkflowRun } from '../../../shared/mam/domain/workflow'
import type { WorkflowRunProjection } from '../state-store/git-state-projection'

export function taskReviewPanel(projection: WorkflowRunProjection, taskId: string) {
  return Object.values(projection.reviewPanels).find(
    (panel) =>
      panel.subject.taskId === taskId &&
      projection.tasks[taskId]?.knownAttemptIds.at(-1) === panel.subject.attemptId
  )
}

export function projectedRunStatus(
  bundle: WorkflowRunBundle,
  nodeRuns: readonly NodeRun[]
): WorkflowRun['status'] {
  const finishIds = new Set(
    bundle.definition.nodes.filter((node) => node.type === 'finish').map((node) => node.id)
  )
  if (nodeRuns.some((node) => finishIds.has(node.nodeId) && node.status === 'passed')) {
    return 'completed'
  }
  if (nodeRuns.some((node) => node.status === 'blocked')) return 'blocked'
  if (nodeRuns.some((node) => node.status === 'waiting_for_approval')) {
    return 'waiting_for_approval'
  }
  if (nodeRuns.some((node) => node.status === 'waiting_for_human_input')) {
    return 'awaiting_human_decision'
  }
  return 'running'
}

export function roleCatalogVersions(
  bundle: WorkflowRunBundle
): ReadonlyMap<string, ReadonlySet<number>> {
  const versions = new Map<string, Set<number>>()
  for (const entry of bundle.run.roleCatalog) {
    const current = versions.get(entry.roleProfileId) ?? new Set<number>()
    current.add(entry.roleProfileVersion)
    versions.set(entry.roleProfileId, current)
  }
  return versions
}

export function isPassedTaskStatus(status: string | undefined): boolean {
  return status === 'submitted' || status === 'approved' || status === 'completed'
}
