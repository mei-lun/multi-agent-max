import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import { GitCommandRetryCoordinator } from '../state-store/git-command-retry-coordinator'
import type { GitStateRepository } from '../state-store/git-state-repository'
import { latestSubmittedReviewSubject, reachableReviewNodeIds } from './review-route-projection'
import { projectWorkflowRun } from './workflow-run-projection'

export function advanceReadyReviewPanel(input: {
  repository: GitStateRepository
  workflowRunId: string
  sourceTaskId: string
  sourceNodeId: string
  schedulerId: string
  commandId: string
  issuedAt: string
}): boolean {
  const bundle = input.repository.loadRunBundle(input.workflowRunId)
  if (!bundle) throw new Error('run_bundle_missing')
  const projection = input.repository.rebuild(input.workflowRunId)
  const subject = latestSubmittedReviewSubject(projection, input.sourceTaskId)
  if (!subject) return false
  const eligible = new Set(reachableReviewNodeIds(bundle, input.sourceNodeId))
  const run = projectWorkflowRun(bundle, projection, input.issuedAt)
  const reviewNodeId = run.nodeRuns.find(
    (nodeRun) =>
      eligible.has(nodeRun.nodeId) &&
      nodeRun.status === 'ready' &&
      !Object.values(projection.reviewPanels).some(
        (panel) =>
          panel.reviewNodeId === nodeRun.nodeId && panel.subject.attemptId === subject.attemptId
      )
  )?.nodeId
  if (!reviewNodeId) return false
  const command: Extract<SchedulerCommand, { type: 'create_review_panel' }> = {
    schemaVersion: '1.0.0',
    commandId: input.commandId,
    issuedAt: input.issuedAt,
    workflowRunId: input.workflowRunId,
    taskId: input.sourceTaskId,
    actor: { kind: 'scheduler', schedulerId: input.schedulerId },
    type: 'create_review_panel',
    reviewNodeId,
    subject
  }
  new GitCommandRetryCoordinator(input.repository).executeAndPush({
    command,
    schedulerId: input.schedulerId
  })
  return true
}
