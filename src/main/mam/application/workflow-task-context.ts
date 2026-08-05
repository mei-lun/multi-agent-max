import type { MergeConflictResolution } from '../../../shared/mam/domain/merge-conflict-task'
import type { MergeQueueEntry } from '../../../shared/mam/domain/merge-queue'
import type { ReviewSubject } from '../../../shared/mam/domain/review'
import type { WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'
import type { WorkflowRunProjection } from '../state-store/git-event-projection'
import { mergeNodeHasCompleted } from './merge-node-projection'
import { resolvedReviewStatus } from './review-disagreement-resolution'
import { latestSubmittedReviewSubject, reachableReviewNodeIds } from './review-route-projection'
import {
  isPassedTaskStatus,
  roleCatalogVersions,
  taskReviewPanel
} from './workflow-projection-state'
import { projectWorkflowRoute } from './workflow-route-projection'

export type TaskContextDefinition = Readonly<{
  initialStatus: 'waiting_dependencies' | 'waiting_role_assignment'
  allowedRoleProfileIds: readonly string[]
  roleCatalogVersions: ReadonlyMap<string, ReadonlySet<number>>
  reviewTarget?: ReviewSubject
  allowedReviewNodeIds: readonly string[]
  minimumReviewDecisions?: number
  mergeCandidate?: MergeQueueEntry
  mergeResolutionCandidate?: MergeConflictResolution
}>

export function taskContextDefinition(
  bundle: WorkflowRunBundle,
  projection: WorkflowRunProjection,
  taskId: string
): TaskContextDefinition | undefined {
  const task = bundle.taskCatalog.find((candidate) => candidate.id === taskId)
  if (task) {
    if (projectWorkflowRoute(bundle, projection).cancelledNodeIds.has(task.nodeId)) {
      return waitingContext(bundle, task.allowedRoleProfileIds)
    }
    const planNode = bundle.plan.nodes.find((node) => node.id === task.nodeId)!
    const ready = planNode.dependencies.every((nodeId) =>
      passedNodeIds(bundle, projection).has(nodeId)
    )
    return reviewableContext({
      bundle,
      projection,
      taskId,
      nodeId: task.nodeId,
      allowedRoleProfileIds: task.allowedRoleProfileIds,
      ready
    })
  }
  const dynamicTask = projection.dynamicTasks[taskId]
  if (dynamicTask) {
    if (projectWorkflowRoute(bundle, projection).cancelledNodeIds.has(dynamicTask.nodeId)) {
      return waitingContext(bundle, dynamicTask.allowedRoleProfileIds)
    }
    const source = projection.tasks[dynamicTask.parentTaskId]
    const ready =
      Boolean(source?.dynamicTaskPlanHash) &&
      dynamicTask.dependencies.every((dependency) =>
        isPassedTaskStatus(projection.tasks[dependency]?.status)
      )
    return reviewableContext({
      bundle,
      projection,
      taskId,
      nodeId: dynamicTask.nodeId,
      allowedRoleProfileIds: dynamicTask.allowedRoleProfileIds,
      ready
    })
  }
  return generatedTaskContext(bundle, projection, taskId)
}

export function passedNodeIds(
  bundle: WorkflowRunBundle,
  projection: WorkflowRunProjection
): Set<string> {
  const passed = new Set([
    ...projectWorkflowRoute(bundle, projection).cancelledNodeIds,
    ...Object.keys(projection.reusedNodeCompletions)
  ])
  const taskByNode = new Map(bundle.taskCatalog.map((task) => [task.nodeId, task]))
  for (const [nodeId, task] of taskByNode) {
    const status = projection.tasks[task.id]?.status
    const node = bundle.definition.nodes.find((candidate) => candidate.id === nodeId)!
    if (node.type === 'dynamic_tasks') {
      const children = Object.values(projection.dynamicTasks).filter(
        (candidate) => candidate.parentTaskId === task.id
      )
      if (
        children.length > 0 &&
        children.every((child) => isPassedTaskStatus(projection.tasks[child.id]?.status))
      ) {
        passed.add(nodeId)
      }
    } else if (isPassedTaskStatus(status)) passed.add(nodeId)
  }
  for (const node of bundle.definition.nodes.filter(
    (candidate) => candidate.type === 'review_gate'
  )) {
    const approved = Object.values(projection.reviewAggregations).some(
      (aggregation) =>
        aggregation.reviewNodeId === node.id &&
        resolvedReviewStatus(aggregation, projection) === 'approved' &&
        projection.tasks[aggregation.subject.taskId]?.knownAttemptIds.at(-1) ===
          aggregation.subject.attemptId
    )
    if (approved) passed.add(node.id)
  }
  for (const nodeId of Object.keys(projection.resolvedConditions)) passed.add(nodeId)
  for (const execution of Object.values(projection.systemNodeExecutions)) {
    if (execution.status === 'passed') passed.add(execution.nodeId)
  }
  settleSystemNodes(bundle, projection, taskByNode, passed)
  return passed
}

function reviewableContext(input: {
  bundle: WorkflowRunBundle
  projection: WorkflowRunProjection
  taskId: string
  nodeId: string
  allowedRoleProfileIds: readonly string[]
  ready: boolean
}): TaskContextDefinition {
  const reviewTarget = latestSubmittedReviewSubject(input.projection, input.taskId)
  const panel = taskReviewPanel(input.projection, input.taskId)
  const reviewNode = panel
    ? input.bundle.definition.nodes.find(
        (node) => node.id === panel.reviewNodeId && node.type === 'review_gate'
      )
    : undefined
  return {
    initialStatus: input.ready ? 'waiting_role_assignment' : 'waiting_dependencies',
    allowedRoleProfileIds: input.allowedRoleProfileIds,
    roleCatalogVersions: roleCatalogVersions(input.bundle),
    allowedReviewNodeIds: reachableReviewNodeIds(input.bundle, input.nodeId),
    ...(reviewTarget ? { reviewTarget } : {}),
    ...(reviewNode?.type === 'review_gate'
      ? { minimumReviewDecisions: reviewNode.minimumDecisions }
      : {})
  }
}

function generatedTaskContext(
  bundle: WorkflowRunBundle,
  projection: WorkflowRunProjection,
  taskId: string
): TaskContextDefinition | undefined {
  const reviewTask = projection.reviewTasks[taskId]
  if (!reviewTask) {
    const conflictTask = projection.mergeConflictTasks[taskId]
    return conflictTask
      ? {
          ...waitingContext(bundle, conflictTask.allowedRoleProfileIds),
          initialStatus: 'waiting_role_assignment'
        }
      : undefined
  }
  const reviewNode = bundle.definition.nodes.find(
    (node) => node.id === reviewTask.reviewNodeId && node.type === 'review_gate'
  )
  return {
    initialStatus: 'waiting_role_assignment',
    allowedRoleProfileIds: reviewTask.allowedRoleProfileIds,
    roleCatalogVersions: roleCatalogVersions(bundle),
    allowedReviewNodeIds: [],
    reviewTarget: reviewTask.subject,
    minimumReviewDecisions: reviewNode?.type === 'review_gate' ? reviewNode.minimumDecisions : 1
  }
}

function waitingContext(
  bundle: WorkflowRunBundle,
  allowedRoleProfileIds: readonly string[]
): TaskContextDefinition {
  return {
    initialStatus: 'waiting_dependencies',
    allowedRoleProfileIds,
    roleCatalogVersions: roleCatalogVersions(bundle),
    allowedReviewNodeIds: []
  }
}

function settleSystemNodes(
  bundle: WorkflowRunBundle,
  projection: WorkflowRunProjection,
  taskByNode: ReadonlyMap<string, unknown>,
  passed: Set<string>
): void {
  let changed = true
  while (changed) {
    changed = false
    for (const node of bundle.definition.nodes) {
      if (passed.has(node.id) || taskByNode.has(node.id)) continue
      const planNode = bundle.plan.nodes.find((candidate) => candidate.id === node.id)!
      if (!planNode.dependencies.every((dependency) => passed.has(dependency))) continue
      const autoPass =
        node.type === 'parallel' ||
        node.type === 'join' ||
        node.type === 'finish' ||
        (node.type === 'git_merge' && mergeNodeHasCompleted(node.id, projection, bundle)) ||
        (node.type === 'approval_gate' && Boolean(projection.resolvedApprovalGates[node.id]))
      if (autoPass) {
        passed.add(node.id)
        changed = true
      }
    }
  }
}
