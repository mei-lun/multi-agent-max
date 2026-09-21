import {
  ReviewAggregationSchema,
  ReviewDecisionSchema,
  type ReviewAggregation,
  type ReviewDecision,
  type ReviewFinding
} from '../../../shared/mam/domain/review'
import { boundedReviewStatus } from './review-revision-limit'

export type ReviewAggregationCalculationInput = Readonly<{
  decisions: readonly unknown[]
  createdAt: string
  formalRevisionNumber: number
  maxRevisionAttempts: number
}>

export class ReviewAggregationCalculationError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'ReviewAggregationCalculationError'
  }
}

export function calculateReviewAggregation(
  input: ReviewAggregationCalculationInput
): ReviewAggregation {
  if (input.decisions.length === 0) {
    fail('review_decisions_required', 'aggregation requires decisions')
  }
  if (!Number.isInteger(input.formalRevisionNumber) || input.formalRevisionNumber < 0) {
    fail('review_revision_invalid', 'formal revision number must be a non-negative integer')
  }
  if (!Number.isInteger(input.maxRevisionAttempts) || input.maxRevisionAttempts < 1) {
    fail('review_revision_limit_invalid', 'maximum revision Attempts must be positive')
  }
  const decisions = input.decisions
    .map((decision) => ReviewDecisionSchema.parse(decision))
    .sort(compareDecisions)
  assertSameReview(decisions)
  const first = decisions[0]!
  const classification = classify(decisions)
  const status = proposedStatus(decisions, classification)
  return ReviewAggregationSchema.parse({
    schemaVersion: '1.0.0',
    id: `aggregation.${first.reviewNodeId}.${first.attemptId}`,
    workflowRunId: first.workflowRunId,
    reviewNodeId: first.reviewNodeId,
    attemptId: first.attemptId,
    subject: first.subject,
    classification,
    sourceDecisionIds: decisions.map((decision) => decision.id),
    findings: mergeFindings(decisions),
    proposedStatus: boundedReviewStatus({
      status,
      revisionCount: input.formalRevisionNumber,
      maxRevisionAttempts: input.maxRevisionAttempts
    }),
    requiresHumanDecision: classification === 'blocking_disagreement',
    createdAt: input.createdAt
  })
}

function compareDecisions(left: ReviewDecision, right: ReviewDecision): number {
  return left.reviewerTaskId.localeCompare(right.reviewerTaskId) || left.id.localeCompare(right.id)
}

function assertSameReview(decisions: readonly ReviewDecision[]): void {
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
      fail('review_binding_mismatch', 'opinions target different reviews')
    }
    if (reviewerIds.has(decision.reviewerRoleInstanceId)) {
      fail('duplicate_reviewer', 'reviewer submitted more than once')
    }
    reviewerIds.add(decision.reviewerRoleInstanceId)
    if (reviewerAttemptIds.has(decision.reviewerAttemptId)) {
      fail('duplicate_reviewer_attempt', 'review Attempt submitted more than once')
    }
    reviewerAttemptIds.add(decision.reviewerAttemptId)
  }
}

function classify(decisions: readonly ReviewDecision[]): ReviewAggregation['classification'] {
  const statuses = new Set(decisions.map((decision) => decision.status))
  if (statuses.size > 1) return 'blocking_disagreement'
  if (decisions[0]!.status !== 'changes_requested') return 'consensus'
  const signatures = new Set(decisions.map((decision) => findingSetSignature(decision.findings)))
  return signatures.size === 1 ? 'consensus' : 'mergeable_disagreement'
}

function proposedStatus(
  decisions: readonly ReviewDecision[],
  classification: ReviewAggregation['classification']
): ReviewAggregation['proposedStatus'] {
  return classification === 'blocking_disagreement' ? 'blocked' : decisions[0]!.status
}

function mergeFindings(decisions: readonly ReviewDecision[]): ReviewFinding[] {
  const findings = new Map<string, ReviewFinding>()
  for (const decision of decisions) {
    for (const finding of decision.findings) {
      const key = findingSignature(finding)
      const current = findings.get(key)
      if (!current || finding.id.localeCompare(current.id) < 0) findings.set(key, finding)
    }
  }
  return [...findings.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, finding]) => finding)
}

function findingSetSignature(findings: readonly ReviewFinding[]): string {
  return findings.map(findingSignature).sort().join('|')
}

function findingSignature(finding: ReviewFinding): string {
  return [
    finding.category,
    finding.filePath ?? '',
    String(finding.line ?? ''),
    finding.summary
  ].join('\0')
}

function fail(code: string, message: string): never {
  throw new ReviewAggregationCalculationError(code, message)
}
