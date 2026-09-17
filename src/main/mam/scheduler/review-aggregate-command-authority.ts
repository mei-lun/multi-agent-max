import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import type { SchedulerKernelContext } from './scheduler-kernel-context'
import { SchedulerCommandRejectedError } from './scheduler-command-rejection'
import { aggregateReviewGates } from '../review/review-aggregate-node-service'

export function assertReviewAggregateAuthority(
  command: Extract<SchedulerCommand, { type: 'record_review_aggregate' }>,
  context: SchedulerKernelContext
): void {
  if (command.actor.kind !== 'scheduler' || command.actor.schedulerId !== context.schedulerId)
    fail('scheduler_authority_required', 'Review aggregate requires Scheduler authority')
  const node = context.runBundle?.definition.nodes.find(
    (candidate) =>
      candidate.id === command.aggregation.reviewNodeId && candidate.type === 'review_aggregate'
  )
  if (!node || node.type !== 'review_aggregate')
    fail('review_aggregate_node_invalid', 'Review aggregate node is unavailable')
  const producerTaskId = context.runBundle?.taskCatalog.find(
    (task) => task.nodeId === node.producerNodeId
  )?.id
  if (
    !producerTaskId ||
    command.aggregation.subject.taskId !== producerTaskId ||
    context.taskCurrentDeliveryIds?.get(producerTaskId) !== command.aggregation.subject.attemptId
  ) {
    fail('review_aggregate_stale_subject', 'Review aggregate does not target the current Delivery')
  }
  const members = command.memberAggregationIds.map((id) => context.reviewAggregations?.get(id))
  if (members.some((member) => !member))
    fail('review_aggregate_member_missing', 'Review aggregate member is unavailable')
  if (
    members.some(
      (member) => JSON.stringify(member!.subject) !== JSON.stringify(command.aggregation.subject)
    )
  )
    fail(
      'review_aggregate_subject_mismatch',
      'Review aggregate members target different deliveries'
    )
  const memberNodes = [...new Set(members.map((member) => member!.reviewNodeId))].sort()
  const expectedNodes = node.reviewNodeIds.slice(0, node.totalQuorum).sort()
  if (JSON.stringify(memberNodes) !== JSON.stringify(expectedNodes))
    fail(
      'review_aggregate_member_mismatch',
      'Review aggregate members do not satisfy the configured quorum'
    )
  const expected = aggregateReviewGates({
    aggregateNodeId: node.id,
    aggregations: members as NonNullable<(typeof members)[number]>[],
    totalQuorum: node.totalQuorum,
    formalRevisionNumber: context.task?.formalRevisionNumber ?? 0,
    maxRevisionAttempts: node.maxRevisionAttempts,
    createdAt: command.aggregation.createdAt
  })
  if (JSON.stringify(expected) !== JSON.stringify(command.aggregation)) {
    fail('review_aggregate_mismatch', 'Review aggregate is not deterministic')
  }
}

function fail(code: string, message: string): never {
  throw new SchedulerCommandRejectedError(code, message)
}
