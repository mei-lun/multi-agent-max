import {
  ReviewAggregationSchema,
  ReviewDecisionSchema,
  ReviewDisagreementResolutionSchema,
  type ReviewAggregation,
  type ReviewDecision,
  type ReviewDisagreementResolution,
  type ReviewFinding
} from '../../../shared/mam/domain/review'
import type { KernelEventBatch } from '../scheduler/kernel'
import { isKernelEventBatch } from '../scheduler/kernel'

export type ReviewAggregationState = Readonly<{
  status: 'aggregated' | 'awaiting_human_decision' | 'resolved'
  gateId?: string
  aggregation: ReviewAggregation
  resolution?: ReviewDisagreementResolution
}>

export class ReviewAggregationError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'ReviewAggregationError'
  }
}

export class ReviewAggregationPolicy {
  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  aggregate(decisionInputs: readonly unknown[]): ReviewAggregationState {
    if (decisionInputs.length === 0) {
      throw new ReviewAggregationError(
        'review_decisions_required',
        'aggregation requires decisions'
      )
    }
    const decisions = decisionInputs.map((input) => ReviewDecisionSchema.parse(input))
    const first = decisions[0]!
    this.assertSameReview(decisions)
    const classification = classify(decisions)
    const findings = mergeFindings(decisions)
    const aggregation = ReviewAggregationSchema.parse({
      schemaVersion: '1.0.0',
      id: `aggregation.${first.reviewNodeId}.${first.attemptId}`,
      workflowRunId: first.workflowRunId,
      reviewNodeId: first.reviewNodeId,
      attemptId: first.attemptId,
      subject: first.subject,
      classification,
      sourceDecisionIds: decisions.map((decision) => decision.id),
      findings,
      proposedStatus: proposedStatus(decisions, classification),
      requiresHumanDecision: classification === 'blocking_disagreement',
      createdAt: this.now()
    })
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

  private assertSameReview(decisions: readonly ReviewDecision[]): void {
    const first = decisions[0]!
    const reviewerIds = new Set<string>()
    const reviewerAttemptIds = new Set<string>()
    for (const decision of decisions) {
      if (
        decision.workflowRunId !== first.workflowRunId ||
        decision.reviewNodeId !== first.reviewNodeId ||
        decision.attemptId !== first.attemptId ||
        JSON.stringify(decision.subject) !== JSON.stringify(first.subject)
      ) {
        throw new ReviewAggregationError(
          'review_binding_mismatch',
          'opinions target different reviews'
        )
      }
      if (reviewerIds.has(decision.reviewerRoleInstanceId)) {
        throw new ReviewAggregationError('duplicate_reviewer', 'reviewer submitted more than once')
      }
      reviewerIds.add(decision.reviewerRoleInstanceId)
      if (reviewerAttemptIds.has(decision.reviewerAttemptId)) {
        throw new ReviewAggregationError(
          'duplicate_reviewer_attempt',
          'review Attempt submitted more than once'
        )
      }
      reviewerAttemptIds.add(decision.reviewerAttemptId)
    }
  }
}

function classify(decisions: readonly ReviewDecision[]): ReviewAggregation['classification'] {
  const statuses = new Set(decisions.map((decision) => decision.status))
  if (statuses.size > 1) {
    return 'blocking_disagreement'
  }
  if (decisions[0]!.status !== 'changes_requested') {
    return 'consensus'
  }
  const signatures = new Set(decisions.map((decision) => findingSetSignature(decision.findings)))
  return signatures.size === 1 ? 'consensus' : 'mergeable_disagreement'
}

function proposedStatus(
  decisions: readonly ReviewDecision[],
  classification: ReviewAggregation['classification']
): ReviewAggregation['proposedStatus'] {
  if (classification === 'blocking_disagreement') {
    return 'blocked'
  }
  return decisions[0]!.status
}

function mergeFindings(decisions: readonly ReviewDecision[]): ReviewFinding[] {
  const findings = new Map<string, ReviewFinding>()
  for (const decision of decisions) {
    for (const finding of decision.findings) {
      const key = `${finding.category}\0${finding.filePath ?? ''}\0${finding.line ?? ''}\0${finding.summary}`
      if (!findings.has(key)) {
        findings.set(key, finding)
      }
    }
  }
  return [...findings.values()]
}

function findingSetSignature(findings: readonly ReviewFinding[]): string {
  return findings
    .map(
      (finding) =>
        `${finding.category}:${finding.filePath ?? ''}:${finding.line ?? ''}:${finding.summary}`
    )
    .sort()
    .join('|')
}

function freezeState(state: ReviewAggregationState): ReviewAggregationState {
  return Object.freeze({ ...state })
}
