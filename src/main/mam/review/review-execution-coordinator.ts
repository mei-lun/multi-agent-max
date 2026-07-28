import { createHash } from 'node:crypto'
import { z } from 'zod'
import { ArtifactVersionSchema, type ArtifactVersion } from '../../../shared/mam/domain/artifact'
import { IsoTimestampSchema, MamEntityIdSchema } from '../../../shared/mam/domain/primitives'
import {
  ReviewDecisionSchema,
  ReviewPanelAssignmentSchema,
  ReviewSubjectSchema,
  type ReviewDecision,
  type ReviewPanelAssignment,
  type ReviewSubject
} from '../../../shared/mam/domain/review'
import { ReviewAggregationPolicy, type ReviewAggregationState } from './review-aggregation-policy'

const ReviewPanelRequestSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    id: MamEntityIdSchema,
    workflowRunId: MamEntityIdSchema,
    reviewNodeId: MamEntityIdSchema,
    subject: ReviewSubjectSchema,
    minimumDecisions: z.number().int().positive(),
    reviewers: z
      .array(
        z
          .object({
            reviewerTaskId: MamEntityIdSchema,
            reviewerAttemptId: MamEntityIdSchema,
            roleProfileId: MamEntityIdSchema,
            roleProfileVersion: z.number().int().positive(),
            roleInstanceId: MamEntityIdSchema,
            executorInvocationId: MamEntityIdSchema,
            startedAt: IsoTimestampSchema
          })
          .strict()
      )
      .min(1)
  })
  .strict()

const ReviewSubmissionAuthoritySchema = z
  .object({
    reviewerTaskId: MamEntityIdSchema,
    reviewerAttemptId: MamEntityIdSchema,
    roleInstanceId: MamEntityIdSchema,
    executorInvocationId: MamEntityIdSchema,
    completedAt: IsoTimestampSchema
  })
  .strict()

type ReviewPanelRequest = z.infer<typeof ReviewPanelRequestSchema>

export type ReviewPanelState = Readonly<{
  id: string
  workflowRunId: string
  reviewNodeId: string
  subject: ReviewSubject
  minimumDecisions: number
  status: 'collecting' | 'aggregated' | 'awaiting_human_decision' | 'invalidated'
  assignments: readonly ReviewPanelAssignment[]
  aggregation?: ReviewAggregationState
  supersededBy?: ReviewSubject
}>

export class ReviewExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'ReviewExecutionError'
  }
}

export class ReviewExecutionCoordinator {
  constructor(private readonly aggregation = new ReviewAggregationPolicy()) {}

  createPanel(input: unknown): ReviewPanelState {
    const request = ReviewPanelRequestSchema.parse(input)
    if (request.minimumDecisions > request.reviewers.length) {
      fail('review_quorum_unreachable', 'Review quorum exceeds the assigned reviewer count')
    }
    assertUniqueReviewers(request.reviewers)
    const assignments = request.reviewers.map((reviewer) =>
      ReviewPanelAssignmentSchema.parse({
        schemaVersion: '1.0.0',
        id: reviewAssignmentId(request.id, reviewer.reviewerTaskId),
        workflowRunId: request.workflowRunId,
        reviewNodeId: request.reviewNodeId,
        attemptId: request.subject.attemptId,
        subject: request.subject,
        reviewerTaskId: reviewer.reviewerTaskId,
        reviewerAttemptId: reviewer.reviewerAttemptId,
        roleProfileId: reviewer.roleProfileId,
        roleProfileVersion: reviewer.roleProfileVersion,
        roleInstanceId: reviewer.roleInstanceId,
        executorInvocationId: reviewer.executorInvocationId,
        status: 'running',
        startedAt: reviewer.startedAt
      })
    )
    return freezePanel({
      id: request.id,
      workflowRunId: request.workflowRunId,
      reviewNodeId: request.reviewNodeId,
      subject: request.subject,
      minimumDecisions: request.minimumDecisions,
      status: 'collecting',
      assignments
    })
  }

  submit(
    state: ReviewPanelState,
    authorityInput: unknown,
    decisionInput: unknown,
    artifactInput: unknown
  ): ReviewPanelState {
    if (state.status !== 'collecting') fail('review_panel_closed', 'Review panel is not collecting')
    const authority = ReviewSubmissionAuthoritySchema.parse(authorityInput)
    const decision = ReviewDecisionSchema.parse(decisionInput)
    const artifact = ArtifactVersionSchema.parse(artifactInput)
    const index = state.assignments.findIndex(
      (assignment) => assignment.reviewerTaskId === authority.reviewerTaskId
    )
    if (index < 0) fail('review_assignment_not_found', 'Reviewer Task is outside this panel')
    const assignment = state.assignments[index]!
    assertReviewSubmission(state, assignment, authority, decision, artifact)
    if (assignment.status !== 'running') {
      fail('review_already_submitted', 'Review assignment already has a result')
    }
    const assignments = [...state.assignments]
    assignments[index] = ReviewPanelAssignmentSchema.parse({
      ...assignment,
      status: 'submitted',
      decision,
      artifact: {
        artifactId: artifact.id,
        version: artifact.version,
        contentHash: artifact.contentHash
      },
      completedAt: authority.completedAt
    })
    const decisions = assignments.flatMap((candidate) =>
      candidate.status === 'submitted' && candidate.decision ? [candidate.decision] : []
    )
    if (decisions.length < state.minimumDecisions) {
      return freezePanel({ ...state, assignments })
    }
    const aggregation = this.aggregation.aggregate(decisions)
    return freezePanel({
      ...state,
      assignments,
      aggregation,
      status:
        aggregation.status === 'awaiting_human_decision' ? 'awaiting_human_decision' : 'aggregated'
    })
  }

  invalidateIfSuperseded(state: ReviewPanelState, latestSubjectInput: unknown): ReviewPanelState {
    const latestSubject = ReviewSubjectSchema.parse(latestSubjectInput)
    if (sameSubject(state.subject, latestSubject)) return state
    return freezePanel({
      ...state,
      status: 'invalidated',
      supersededBy: latestSubject
    })
  }
}

function assertReviewSubmission(
  state: ReviewPanelState,
  assignment: ReviewPanelAssignment,
  authority: z.infer<typeof ReviewSubmissionAuthoritySchema>,
  decision: ReviewDecision,
  artifact: ArtifactVersion
): void {
  if (
    authority.reviewerAttemptId !== assignment.reviewerAttemptId ||
    authority.roleInstanceId !== assignment.roleInstanceId ||
    authority.executorInvocationId !== assignment.executorInvocationId ||
    decision.workflowRunId !== state.workflowRunId ||
    decision.reviewNodeId !== state.reviewNodeId ||
    decision.reviewerTaskId !== assignment.reviewerTaskId ||
    decision.reviewerAttemptId !== assignment.reviewerAttemptId ||
    decision.reviewerRoleInstanceId !== assignment.roleInstanceId ||
    !sameSubject(decision.subject, state.subject)
  ) {
    fail('review_submission_binding_mismatch', 'Review does not match its panel assignment')
  }
  if (
    artifact.workflowRunId !== state.workflowRunId ||
    artifact.taskId !== assignment.reviewerTaskId ||
    artifact.attemptId !== assignment.reviewerAttemptId ||
    artifact.roleInstanceId !== assignment.roleInstanceId
  ) {
    fail('review_artifact_binding_mismatch', 'Review Artifact targets another reviewer Attempt')
  }
  if (artifact.availability !== 'git' || artifact.validationStatus !== 'valid') {
    fail('review_artifact_not_git', 'Review decision requires a valid Git-readable Artifact')
  }
}

function assertUniqueReviewers(reviewers: ReviewPanelRequest['reviewers']): void {
  for (const field of [
    'reviewerTaskId',
    'reviewerAttemptId',
    'roleInstanceId',
    'executorInvocationId'
  ] as const) {
    if (new Set(reviewers.map((reviewer) => reviewer[field])).size !== reviewers.length) {
      fail('duplicate_review_assignment', `Review panel repeats ${field}`)
    }
  }
}

function sameSubject(left: ReviewSubject, right: ReviewSubject): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function reviewAssignmentId(panelId: string, reviewerTaskId: string): string {
  const digest = createHash('sha256').update(`${panelId}\0${reviewerTaskId}`).digest('hex')
  return `review-assignment.${digest.slice(0, 40)}`
}

function freezePanel(state: ReviewPanelState): ReviewPanelState {
  return Object.freeze({ ...state, assignments: Object.freeze([...state.assignments]) })
}

function fail(code: string, message: string): never {
  throw new ReviewExecutionError(code, message)
}
