import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import { profileContentHash } from '../profiles/profile-content-hash'
import { GitCommandRetryCoordinator } from '../state-store/git-command-retry-coordinator'
import type { GitStateRepository } from '../state-store/git-state-repository'
import { attemptBranchName } from './attempt-worktree-manager'
import { createMergeQueueEntry } from './merge-queue-service'
import { reachableGitMergeNodeIds } from './review-route-projection'

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
  const mergeNodeId = reachableGitMergeNodeIds(bundle, sourceNodeId)[0]
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
