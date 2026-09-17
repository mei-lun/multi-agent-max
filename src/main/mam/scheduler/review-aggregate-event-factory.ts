import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'

export function createReviewAggregateEvent(
  command: Extract<SchedulerCommand, { type: 'record_review_aggregate' }>,
  base: Readonly<Record<string, unknown>>
): unknown {
  return { ...base, type: 'review_aggregate_recorded', taskId: command.taskId, memberAggregationIds: command.memberAggregationIds, aggregation: command.aggregation }
}
