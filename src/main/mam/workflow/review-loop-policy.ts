import {
  ReviewAggregationSchema,
  ReviewDecisionSchema,
  type ReviewAggregation,
  type ReviewDecision
} from '../../../shared/mam/domain/review'

export type ReviewLoopState = Readonly<{
  reviewNodeId: string
  activeAttemptId: string
  attemptNumber: number
  maxRevisionAttempts: number
  status: 'developing' | 'in_review' | 'changes_requested' | 'approved' | 'blocked'
  decisions: readonly ReviewDecision[]
}>

export class ReviewLoopError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'ReviewLoopError'
  }
}

export class ReviewLoopPolicy {
  create(reviewNodeId: string, attemptId: string, maxRevisionAttempts: number): ReviewLoopState {
    if (!Number.isInteger(maxRevisionAttempts) || maxRevisionAttempts < 1) {
      throw new ReviewLoopError('invalid_revision_limit', 'revision limit must be positive')
    }
    return freezeState({
      reviewNodeId,
      activeAttemptId: attemptId,
      attemptNumber: 1,
      maxRevisionAttempts,
      status: 'developing',
      decisions: []
    })
  }

  markInReview(state: ReviewLoopState, attemptId: string): ReviewLoopState {
    this.assertActiveAttempt(state, attemptId)
    if (state.status !== 'developing') {
      throw new ReviewLoopError('invalid_review_transition', 'attempt is not developing')
    }
    return freezeState({ ...state, status: 'in_review' })
  }

  applyDecision(state: ReviewLoopState, decisionInput: unknown): ReviewLoopState {
    const parsed = ReviewDecisionSchema.safeParse(decisionInput)
    if (!parsed.success) {
      throw new ReviewLoopError(
        'invalid_review_decision',
        parsed.error.issues[0]?.message ?? 'review decision is not structured'
      )
    }
    const decision = parsed.data
    this.assertActiveAttempt(state, decision.attemptId)
    if (decision.reviewNodeId !== state.reviewNodeId || state.status !== 'in_review') {
      throw new ReviewLoopError('invalid_review_transition', 'review decision targets another gate')
    }
    const decisions = [...state.decisions, decision]
    if (decision.status === 'approved') {
      return freezeState({ ...state, decisions, status: 'approved' })
    }
    if (decision.status === 'blocked' || state.attemptNumber >= state.maxRevisionAttempts) {
      return freezeState({ ...state, decisions, status: 'blocked' })
    }
    return freezeState({ ...state, decisions, status: 'changes_requested' })
  }

  applyAggregation(state: ReviewLoopState, aggregationInput: unknown): ReviewLoopState {
    const parsed = ReviewAggregationSchema.safeParse(aggregationInput)
    if (!parsed.success) {
      throw new ReviewLoopError(
        'invalid_review_aggregation',
        parsed.error.issues[0]?.message ?? 'review aggregation is not structured'
      )
    }
    const aggregation: ReviewAggregation = parsed.data
    this.assertActiveAttempt(state, aggregation.attemptId)
    if (aggregation.reviewNodeId !== state.reviewNodeId || state.status !== 'in_review') {
      throw new ReviewLoopError(
        'invalid_review_transition',
        'aggregation targets another review gate'
      )
    }
    if (aggregation.requiresHumanDecision) {
      throw new ReviewLoopError(
        'human_review_decision_required',
        'blocking disagreement requires a user decision'
      )
    }
    if (aggregation.proposedStatus === 'approved') {
      return freezeState({ ...state, status: 'approved' })
    }
    if (
      aggregation.proposedStatus === 'blocked' ||
      state.attemptNumber >= state.maxRevisionAttempts
    ) {
      return freezeState({ ...state, status: 'blocked' })
    }
    return freezeState({ ...state, status: 'changes_requested' })
  }

  beginRevision(state: ReviewLoopState, nextAttemptId: string): ReviewLoopState {
    if (state.status !== 'changes_requested') {
      throw new ReviewLoopError('invalid_review_transition', 'revision was not requested')
    }
    if (nextAttemptId === state.activeAttemptId) {
      throw new ReviewLoopError('attempt_reuse', 'revision requires a new attempt')
    }
    return freezeState({
      ...state,
      activeAttemptId: nextAttemptId,
      attemptNumber: state.attemptNumber + 1,
      status: 'developing'
    })
  }

  private assertActiveAttempt(state: ReviewLoopState, attemptId: string): void {
    if (state.activeAttemptId !== attemptId) {
      throw new ReviewLoopError('stale_review_attempt', 'review result belongs to an old attempt')
    }
  }
}

function freezeState(state: ReviewLoopState): ReviewLoopState {
  return Object.freeze({ ...state, decisions: Object.freeze([...state.decisions]) })
}
