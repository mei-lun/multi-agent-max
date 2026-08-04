import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import type { WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'
import type { WorkflowRunProjection } from '../state-store/git-state-projection'
import { profileContentHash } from '../profiles/profile-content-hash'
import { GitCommandRetryCoordinator } from '../state-store/git-command-retry-coordinator'
import type { GitStateRepository } from '../state-store/git-state-repository'
import { attemptBranchName } from './attempt-worktree-manager'
import { createMergeQueueEntry } from './merge-queue-service'
import { reachableGitMergeNodeIds } from './review-route-projection'
import { passedNodeIds } from './workflow-task-context'

export function publishMergeReadinessIfEligible(input: {
  repository: GitStateRepository
  workflowRunId: string
  taskId: string
  schedulerId: string
  commandId: string
  issuedAt: string
}): boolean {
  const bundle = input.repository.loadRunBundle(input.workflowRunId)
  if (!bundle) throw new Error('run_bundle_missing')
  const projection = input.repository.rebuild(input.workflowRunId)
  const task = projection.tasks[input.taskId]
  if (task?.status !== 'approved') return false
  const sourceNodeId =
    bundle.taskCatalog.find((definition) => definition.id === input.taskId)?.nodeId ??
    projection.dynamicTasks[input.taskId]?.nodeId
  if (!sourceNodeId) return false
  const mergeNodeId = nextMergeNodeId(bundle, projection, sourceNodeId, input.taskId)
  if (!mergeNodeId) return false
  const mergeNode = bundle.definition.nodes.find(
    (node) => node.id === mergeNodeId && node.type === 'git_merge'
  )
  if (!mergeNode || mergeNode.type !== 'git_merge') return false
  const attemptId = task.selectedAttemptId ?? task.knownAttemptIds.at(-1)
  const result = attemptId ? projection.attempts[attemptId]?.result : undefined
  if (!attemptId || !result) return false
  const validationEvidence = Object.fromEntries(
    mergeNode.validations.flatMap((command) => {
      const verification = result.verifications.find(
        (candidate) => candidate.command === command && candidate.status === 'passed'
      )
      return verification ? [[command, profileContentHash(verification)] as const] : []
    })
  )
  if (Object.keys(validationEvidence).length !== mergeNode.validations.length) return false
  const entry = createMergeQueueEntry({
    bundle,
    projection,
    mergeNodeId,
    taskId: input.taskId,
    sourceBranch: attemptBranchName(attemptId),
    mergeReadyAt: input.issuedAt,
    validationEvidence
  })
  const command: Extract<SchedulerCommand, { type: 'mark_merge_ready' }> = {
    schemaVersion: '1.0.0',
    commandId: input.commandId,
    issuedAt: input.issuedAt,
    workflowRunId: input.workflowRunId,
    taskId: input.taskId,
    actor: { kind: 'scheduler', schedulerId: input.schedulerId },
    type: 'mark_merge_ready',
    entry
  }
  new GitCommandRetryCoordinator(input.repository).executeAndPush({
    command,
    schedulerId: input.schedulerId
  })
  return true
}

export function publishMergeReadinessForApprovedTasks(input: {
  repository: GitStateRepository
  workflowRunId: string
  schedulerId: string
  nextCommandId(): string
  now(): string
}): number {
  const approvedTaskIds = Object.entries(input.repository.rebuild(input.workflowRunId).tasks)
    .filter(([, task]) => task.status === 'approved')
    .map(([taskId]) => taskId)
    .sort()
  return approvedTaskIds.filter((taskId) =>
    publishMergeReadinessIfEligible({
      ...input,
      taskId,
      commandId: input.nextCommandId(),
      issuedAt: input.now()
    })
  ).length
}

function nextMergeNodeId(
  bundle: WorkflowRunBundle,
  projection: WorkflowRunProjection,
  sourceNodeId: string,
  taskId: string
): string | undefined {
  const reachable = new Set(reachableGitMergeNodeIds(bundle, sourceNodeId))
  const passed = passedNodeIds(bundle, projection)
  const occupied = new Set(
    Object.values(projection.mergeQueueEntries)
      .filter((entry) => entry.taskId === taskId && entry.status !== 'superseded')
      .map((entry) => entry.mergeNodeId)
  )
  return bundle.plan.nodes.find(
    (planNode) =>
      reachable.has(planNode.id) &&
      !occupied.has(planNode.id) &&
      planNode.dependencies.every((dependency) => passed.has(dependency)) &&
      bundle.definition.nodes.some(
        (node) => node.id === planNode.id && node.type === 'git_merge'
      )
  )?.id
}
