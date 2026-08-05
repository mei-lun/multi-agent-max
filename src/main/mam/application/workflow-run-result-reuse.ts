import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import type { WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'
import type { WorkflowRunProjection } from '../state-store/git-state-projection'
import type { GitStateRepository } from '../state-store/git-state-repository'
import { GitCommandRetryCoordinator } from '../state-store/git-command-retry-coordinator'
import { attemptBranchName } from './attempt-worktree-manager'
import { resolvedReviewStatus } from './review-disagreement-resolution'
import { advanceReadyReviewPanel } from './review-panel-advancement'
import { reachableReviewNodeIds } from './review-route-projection'

type ReuseCandidate = Readonly<{
  bundle: WorkflowRunBundle
  projection: WorkflowRunProjection
}>

export function reuseCompatibleWorkflowProgress(input: {
  repository: GitStateRepository
  target: WorkflowRunBundle
  schedulerId: string
  nextCommandId(): string
  now(): string
}): Readonly<{ tasks: number; nodes: number }> {
  const sources = compatibleSources(input.repository, input.target)
  const reusedNodeIds = new Set<string>()
  let tasks = 0
  let nodes = 0
  for (const targetTask of input.target.taskCatalog.filter(
    (task) => task.nodeType === 'role_task'
  )) {
    const source = findReusableTask(input.repository, targetTask.nodeId, sources)
    if (!source) continue
    const role = fixedRole(input.target, targetTask.allowedRoleProfileIds[0])
    if (!role) continue
    const command: Extract<SchedulerCommand, { type: 'reuse_task_result' }> = {
      schemaVersion: '1.0.0',
      commandId: input.nextCommandId(),
      issuedAt: input.now(),
      workflowRunId: input.target.run.id,
      taskId: targetTask.id,
      actor: { kind: 'scheduler', schedulerId: input.schedulerId },
      type: 'reuse_task_result',
      sourceWorkflowRunId: source.bundle.run.id,
      sourceTaskId: source.taskId,
      sourceAttemptId: source.attemptId,
      sourceEventId: source.attempt.lastEventId,
      sourceNodeId: targetTask.nodeId,
      status: source.task.status === 'submitted' ? 'submitted' : 'approved',
      roleProfileId: role.roleProfileId,
      roleProfileVersion: role.roleProfileVersion,
      result: source.attempt.result!
    }
    publish(input.repository, input.schedulerId, command)
    tasks += 1
    if (source.task.status === 'submitted') {
      advanceReadyReviewPanel({
        repository: input.repository,
        workflowRunId: input.target.run.id,
        sourceTaskId: targetTask.id,
        sourceNodeId: targetTask.nodeId,
        schedulerId: input.schedulerId,
        commandId: input.nextCommandId(),
        issuedAt: input.now()
      })
    }
    if (!['approved', 'completed'].includes(source.task.status)) continue
    for (const aggregation of Object.values(source.source.projection.reviewAggregations)) {
      if (
        reusedNodeIds.has(aggregation.reviewNodeId) ||
        aggregation.subject.taskId !== source.taskId ||
        aggregation.subject.attemptId !== source.attemptId ||
        resolvedReviewStatus(aggregation, source.source.projection) !== 'approved' ||
        input.target.definition.nodes.every(
          (node) => node.id !== aggregation.reviewNodeId || node.type !== 'review_gate'
        )
      ) {
        continue
      }
      const nodeCommand: Extract<SchedulerCommand, { type: 'reuse_node_completion' }> = {
        schemaVersion: '1.0.0',
        commandId: input.nextCommandId(),
        issuedAt: input.now(),
        workflowRunId: input.target.run.id,
        actor: { kind: 'scheduler', schedulerId: input.schedulerId },
        type: 'reuse_node_completion',
        nodeId: aggregation.reviewNodeId,
        sourceWorkflowRunId: source.bundle.run.id,
        sourceNodeId: aggregation.reviewNodeId,
        sourceEvidenceId: aggregation.id
      }
      publish(input.repository, input.schedulerId, nodeCommand)
      reusedNodeIds.add(aggregation.reviewNodeId)
      nodes += 1
    }
    const reachableReviews = new Set(reachableReviewNodeIds(input.target, targetTask.nodeId))
    for (const [reviewNodeId, completion] of Object.entries(
      source.source.projection.reusedNodeCompletions
    )) {
      if (
        reusedNodeIds.has(reviewNodeId) ||
        !reachableReviews.has(reviewNodeId) ||
        !reusedReviewEvidenceMatches(
          input.repository,
          source.attemptId,
          completion.sourceWorkflowRunId,
          completion.sourceEvidenceId
        )
      ) {
        continue
      }
      publish(input.repository, input.schedulerId, {
        schemaVersion: '1.0.0',
        commandId: input.nextCommandId(),
        issuedAt: input.now(),
        workflowRunId: input.target.run.id,
        actor: { kind: 'scheduler', schedulerId: input.schedulerId },
        type: 'reuse_node_completion',
        nodeId: reviewNodeId,
        sourceWorkflowRunId: completion.sourceWorkflowRunId,
        sourceNodeId: completion.sourceNodeId,
        sourceEvidenceId: completion.sourceEvidenceId
      })
      reusedNodeIds.add(reviewNodeId)
      nodes += 1
    }
  }
  return { tasks, nodes }
}

function reusedReviewEvidenceMatches(
  repository: GitStateRepository,
  sourceAttemptId: string,
  sourceWorkflowRunId: string,
  sourceEvidenceId: string
): boolean {
  const projection = repository.rebuild(sourceWorkflowRunId)
  const aggregation = projection.reviewAggregations[sourceEvidenceId]
  return Boolean(
    aggregation &&
    aggregation.subject.attemptId === sourceAttemptId &&
    resolvedReviewStatus(aggregation, projection) === 'approved'
  )
}

function compatibleSources(
  repository: GitStateRepository,
  target: WorkflowRunBundle
): ReuseCandidate[] {
  return repository
    .listWorkflowRunIds()
    .filter((runId) => runId !== target.run.id)
    .flatMap((runId) => {
      const bundle = repository.loadRunBundle(runId)
      if (!bundle || !sameExecutionContext(bundle, target)) return []
      return [{ bundle, projection: repository.rebuild(runId) }]
    })
    .sort((left, right) => right.bundle.createdAt.localeCompare(left.bundle.createdAt))
}

function sameExecutionContext(left: WorkflowRunBundle, right: WorkflowRunBundle): boolean {
  return (
    left.run.definitionId === right.run.definitionId &&
    left.run.definitionVersion === right.run.definitionVersion &&
    left.run.planHash === right.run.planHash &&
    JSON.stringify(left.plan.inputArtifacts) === JSON.stringify(right.plan.inputArtifacts)
  )
}

function findReusableTask(
  repository: GitStateRepository,
  nodeId: string,
  sources: readonly ReuseCandidate[]
) {
  for (const source of sources) {
    const definition = source.bundle.taskCatalog.find((task) => task.nodeId === nodeId)
    const task = definition ? source.projection.tasks[definition.id] : undefined
    const attemptId = task?.selectedAttemptId ?? task?.knownAttemptIds.at(-1)
    const attempt = attemptId ? source.projection.attempts[attemptId] : undefined
    const commit = attempt?.result?.system.submittedCommit
    if (
      !definition ||
      !task ||
      !attemptId ||
      !attempt?.result ||
      !['submitted', 'approved', 'completed'].includes(task.status) ||
      attempt.result.status !== 'submitted' ||
      !commit ||
      !repository.hasProjectCommit(commit) ||
      repository.projectRefCommit(attemptBranchName(attemptId)) !== commit
    ) {
      continue
    }
    return { source, bundle: source.bundle, taskId: definition.id, task, attemptId, attempt }
  }
  return undefined
}

function fixedRole(bundle: WorkflowRunBundle, roleProfileId: string | undefined) {
  return roleProfileId
    ? bundle.run.roleCatalog.find((entry) => entry.roleProfileId === roleProfileId)
    : undefined
}

function publish(
  repository: GitStateRepository,
  schedulerId: string,
  command: SchedulerCommand
): void {
  new GitCommandRetryCoordinator(repository).executeAndPush({ command, schedulerId })
}
