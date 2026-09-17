import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import { aggregateReviewGates } from '../review/review-aggregate-node-service'
import { GitCommandRetryCoordinator } from '../state-store/git-command-retry-coordinator'
import type { GitStateRepository } from '../state-store/git-state-repository'
import { currentTaskDeliveryAttemptId } from './current-task-delivery'
import { countFormalRevisions } from '../review/review-revision-counter'

export function advanceReadyReviewAggregates(input: {
  repository: GitStateRepository
  workflowRunId: string
  schedulerId: string
  nextCommandId(): string
  now(): string
}): readonly string[] {
  const bundle = input.repository.loadRunBundle(input.workflowRunId)
  if (!bundle) throw new Error('run_bundle_missing')
  const projection = input.repository.rebuild(input.workflowRunId)
  const completed: string[] = []
  for (const node of bundle.definition.nodes.filter(
    (candidate) => candidate.type === 'review_aggregate'
  )) {
    const producerTaskId = bundle.taskCatalog.find(
      (task) => task.nodeId === node.producerNodeId
    )?.id
    const currentAttemptId = producerTaskId
      ? currentTaskDeliveryAttemptId(projection.tasks[producerTaskId], projection.attempts)
      : undefined
    if (!currentAttemptId) continue
    if (
      Object.values(projection.reviewAggregations).some(
        (item) => item.reviewNodeId === node.id && item.subject.attemptId === currentAttemptId
      )
    )
      continue
    const quorumNodeIds = node.reviewNodeIds.slice(0, node.totalQuorum)
    const members = Object.values(projection.reviewAggregations).filter(
      (item) =>
        quorumNodeIds.includes(item.reviewNodeId) &&
        item.subject.attemptId === currentAttemptId
    )
    if (new Set(members.map((member) => member.reviewNodeId)).size !== quorumNodeIds.length) continue
    const aggregation = aggregateReviewGates({
      aggregateNodeId: node.id,
      aggregations: members,
      totalQuorum: node.totalQuorum,
      formalRevisionNumber: countFormalRevisions({
        attemptId: currentAttemptId,
        attempts: projection.attempts
      }),
      maxRevisionAttempts: node.maxRevisionAttempts,
      createdAt: input.now()
    })
    const command: Extract<SchedulerCommand, { type: 'record_review_aggregate' }> = {
      schemaVersion: '1.0.0',
      commandId: input.nextCommandId(),
      issuedAt: input.now(),
      workflowRunId: input.workflowRunId,
      taskId: aggregation.subject.taskId,
      actor: { kind: 'scheduler', schedulerId: input.schedulerId },
      type: 'record_review_aggregate',
      memberAggregationIds: members.map((member) => member.id).sort(),
      aggregation
    }
    new GitCommandRetryCoordinator(input.repository).executeAndPush({
      command,
      schedulerId: input.schedulerId
    })
    completed.push(node.id)
  }
  return completed
}
