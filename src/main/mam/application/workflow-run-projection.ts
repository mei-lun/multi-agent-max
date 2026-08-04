import type { StaticTaskDefinition, WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'
import type { NodeRun, WorkflowRun } from '../../../shared/mam/domain/workflow'
import type { WorkflowRunProjection } from '../state-store/git-event-projection'
import { resolvedReviewStatus } from './review-disagreement-resolution'
import { mergeNodeRun } from './merge-node-projection'
import { projectWorkflowRoute, type WorkflowRouteProjection } from './workflow-route-projection'
import { isPassedTaskStatus, projectedRunStatus } from './workflow-projection-state'
import { passedNodeIds, taskContextDefinition } from './workflow-task-context'

export { taskContextDefinition } from './workflow-task-context'

export type WorkflowRunApplicationProjection = Readonly<{
  run: WorkflowRun
  nodeRuns: readonly NodeRun[]
  readyTaskIds: readonly string[]
}>

export function projectWorkflowRun(
  bundle: WorkflowRunBundle,
  projection: WorkflowRunProjection,
  updatedAt: string
): WorkflowRunApplicationProjection {
  const passed = passedNodeIds(bundle, projection)
  const route = projectWorkflowRoute(bundle, projection)
  const tasksByNode = new Map(bundle.taskCatalog.map((task) => [task.nodeId, task]))
  const nodeRuns = bundle.plan.nodes.map((planNode) => {
    const original = bundle.run.nodeRuns.find((nodeRun) => nodeRun.nodeId === planNode.id)!
    const task = tasksByNode.get(planNode.id)
    return projectNodeRun(original, task, planNode.dependencies, bundle, projection, passed, route)
  })
  const visibleNodeRuns = projection.cancellation
    ? nodeRuns.map((nodeRun) =>
        ['passed', 'approved', 'failed', 'blocked', 'cancelled'].includes(nodeRun.status)
          ? nodeRun
          : { ...nodeRun, status: 'cancelled' as const }
      )
    : nodeRuns
  const status = projection.cancellation
    ? ('cancelled' as const)
    : projectedRunStatus(bundle, nodeRuns)
  const run = { ...bundle.run, status, nodeRuns: visibleNodeRuns, updatedAt }
  return {
    run,
    nodeRuns: visibleNodeRuns,
    readyTaskIds: projection.cancellation
      ? []
      : [
          ...bundle.taskCatalog,
          ...Object.values(projection.dynamicTasks),
          ...Object.values(projection.reviewTasks)
        ]
          .filter(
            (task) =>
              !projection.tasks[task.id] &&
              taskContextDefinition(bundle, projection, task.id)?.initialStatus ===
                'waiting_role_assignment'
          )
          .map((task) => task.id)
          .sort()
  }
}

function projectNodeRun(
  original: NodeRun,
  task: StaticTaskDefinition | undefined,
  dependencies: readonly string[],
  bundle: WorkflowRunBundle,
  projection: WorkflowRunProjection,
  passed: ReadonlySet<string>,
  route: WorkflowRouteProjection
): NodeRun {
  if (route.cancelledNodeIds.has(original.nodeId)) return { ...original, status: 'cancelled' }
  if (projection.systemNodeExecutions[original.nodeId]?.status === 'blocked') {
    return { ...original, status: 'blocked' }
  }
  if (task) {
    const node = bundle.definition.nodes.find((candidate) => candidate.id === original.nodeId)!
    if (node.type === 'dynamic_tasks') {
      return dynamicTaskNodeRun(original, task, projection)
    }
    return taskNodeRun(original, projection.tasks[task.id])
  }
  if (passed.has(original.nodeId)) return { ...original, status: 'passed' }
  const dependenciesReady = dependencies.every((nodeId) => passed.has(nodeId))
  if (!dependenciesReady) return { ...original, status: 'waiting_dependencies' }
  const node = bundle.definition.nodes.find((candidate) => candidate.id === original.nodeId)!
  if (node.type === 'review_gate') return reviewNodeRun(original, node.id, projection)
  if (node.type === 'approval_gate') return { ...original, status: 'waiting_for_approval' }
  if (node.type === 'git_merge') return mergeNodeRun(original, node.id, projection, bundle)
  return { ...original, status: 'ready' }
}

function reviewNodeRun(
  original: NodeRun,
  reviewNodeId: string,
  projection: WorkflowRunProjection
): NodeRun {
  const panel = Object.values(projection.reviewPanels).find(
    (candidate) =>
      candidate.reviewNodeId === reviewNodeId &&
      projection.tasks[candidate.subject.taskId]?.knownAttemptIds.at(-1) ===
        candidate.subject.attemptId
  )
  if (!panel) return { ...original, status: 'ready' }
  const aggregation = Object.values(projection.reviewAggregations).find(
    (candidate) =>
      candidate.reviewNodeId === reviewNodeId && candidate.attemptId === panel.subject.attemptId
  )
  if (aggregation) {
    const status = resolvedReviewStatus(aggregation, projection)
    if (!status) return { ...original, status: 'in_review' }
    if (status === 'approved') return { ...original, status: 'passed' }
    if (status === 'changes_requested') {
      return { ...original, status: 'changes_requested' }
    }
    return { ...original, status: 'blocked' }
  }
  const statuses = panel.reviewTaskIds.map((taskId) => projection.tasks[taskId]?.status)
  if (statuses.some((status) => status === 'running')) return { ...original, status: 'running' }
  if (statuses.some((status) => status === 'submitted')) return { ...original, status: 'in_review' }
  return { ...original, status: 'waiting_role_assignment' }
}

function dynamicTaskNodeRun(
  original: NodeRun,
  sourceTask: StaticTaskDefinition,
  projection: WorkflowRunProjection
): NodeRun {
  const source = projection.tasks[sourceTask.id]
  if (!source || !isPassedTaskStatus(source.status)) return taskNodeRun(original, source)
  const children = Object.values(projection.dynamicTasks).filter(
    (task) => task.parentTaskId === sourceTask.id
  )
  const base = {
    ...original,
    attemptIds: [...source.knownAttemptIds],
    ...(source.knownAttemptIds.at(-1) ? { latestAttemptId: source.knownAttemptIds.at(-1) } : {})
  }
  if (children.length === 0) return { ...base, status: 'validating_output' }
  const statuses = children.map((task) => projection.tasks[task.id]?.status)
  if (statuses.every(isPassedTaskStatus)) return { ...base, status: 'passed' }
  if (statuses.some((status) => status === 'blocked' || status === 'needs_attention')) {
    return { ...base, status: 'blocked' }
  }
  if (statuses.some((status) => status === 'running')) return { ...base, status: 'running' }
  if (statuses.some((status) => status === 'ready')) return { ...base, status: 'ready' }
  if (statuses.some((status) => status === undefined)) {
    return { ...base, status: 'waiting_role_assignment' }
  }
  return { ...base, status: 'waiting_dependencies' }
}

function taskNodeRun(
  original: NodeRun,
  task: WorkflowRunProjection['tasks'][string] | undefined
): NodeRun {
  if (!task) return { ...original, status: 'waiting_role_assignment' }
  const mapped = {
    waiting_role_assignment: 'waiting_role_assignment',
    ready: 'ready',
    running: 'running',
    submitted: 'passed',
    in_review: 'in_review',
    changes_requested: 'changes_requested',
    approved: 'passed',
    completed: 'passed',
    blocked: 'blocked',
    cancelled: 'cancelled',
    needs_attention: 'blocked'
  } as const
  return {
    ...original,
    attemptIds: [...task.knownAttemptIds],
    ...(task.knownAttemptIds.at(-1) ? { latestAttemptId: task.knownAttemptIds.at(-1) } : {}),
    status: mapped[task.status as keyof typeof mapped] ?? 'blocked'
  }
}
