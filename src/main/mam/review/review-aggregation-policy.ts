import {
  ReviewDisagreementResolutionSchema,
  type ReviewDisagreementResolution
} from '../../../shared/mam/domain/review'
import type { KernelEventBatch } from '../scheduler/kernel'
import { isKernelEventBatch } from '../scheduler/kernel'
import {
  calculateReviewAggregation,
  ReviewAggregationCalculationError
} from './review-aggregation-calculator'
import type { ReviewAggregation } from '../../../shared/mam/domain/review'

export type ReviewAggregationState = Readonly<{
  status: 'aggregated' | 'awaiting_human_decision' | 'resolved'
  gateId?: string
  aggregation: ReviewAggregation
  resolution?: ReviewDisagreementResolution
}>

export class ReviewAggregationError extends ReviewAggregationCalculationError {}

export class ReviewAggregationPolicy {
  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  aggregate(
    decisionInputs: readonly unknown[],
    bounds: Readonly<{ formalRevisionNumber: number; maxRevisionAttempts: number }> = {
      formalRevisionNumber: 0,
      maxRevisionAttempts: Number.MAX_SAFE_INTEGER
    }
  ): ReviewAggregationState {
    let aggregation: ReviewAggregation
    try {
      aggregation = calculateReviewAggregation({
        decisions: decisionInputs,
        createdAt: this.now(),
        ...bounds
      })
    } catch (error) {
      if (error instanceof ReviewAggregationCalculationError) {
        throw new ReviewAggregationError(error.code, error.message)
      }
      throw error
    }
    const classification = aggregation.classification
    if (classification === 'blocking_disagreement') {
      return freezeState({
        status: 'awaiting_human_decision',
        gateId: `gate.${aggregation.id}`,
        aggregation
      })
    }
    return freezeState({ status: 'aggregated', aggregation })
  }

  applyKernelBatch(state: ReviewAggregationState, batch: KernelEventBatch): ReviewAggregationState {
    if (!isKernelEventBatch(batch)) {
      throw new ReviewAggregationError(
        'scheduler_authority_required',
        'human decision must come from Scheduler Kernel'
      )
    }
    if (state.status !== 'awaiting_human_decision' || !state.gateId) {
      throw new ReviewAggregationError('not_awaiting_decision', 'aggregation is not waiting')
    }
    const event = batch.events.find(
      (candidate) =>
        candidate.type === 'approval_gate_resolved' && candidate.gateId === state.gateId
    )
    if (!event || event.type !== 'approval_gate_resolved') {
      throw new ReviewAggregationError('missing_user_decision', 'batch does not resolve this gate')
    }
    const resolution = ReviewDisagreementResolutionSchema.parse({
      schemaVersion: '1.0.0',
      aggregationId: state.aggregation.id,
      sourceDecisionIds: state.aggregation.sourceDecisionIds,
      commandId: event.commandId,
      userId: event.userId,
      selectedOption: event.option,
      resolvedAt: event.createdAt
    })
    return freezeState({ ...state, status: 'resolved', resolution })
  }
}

function freezeState(state: ReviewAggregationState): ReviewAggregationState {
  return Object.freeze({ ...state })
}
