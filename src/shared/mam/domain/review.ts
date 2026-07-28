import { z } from 'zod'
import { ArtifactContractSchema, ArtifactRefSchema } from './artifact'
import {
  IsoTimestampSchema,
  MamEntityIdSchema,
  MamSchemaVersionSchema,
  Sha256Schema
} from './primitives'

export const ReviewSubjectSchema = z
  .object({
    taskId: MamEntityIdSchema,
    attemptId: MamEntityIdSchema,
    resultHash: Sha256Schema,
    artifactHashes: z.array(Sha256Schema),
    submittedCommit: z.string().min(7).optional()
  })
  .strict()

export const ReviewFindingSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    id: MamEntityIdSchema,
    attemptId: MamEntityIdSchema,
    severity: z.enum(['blocker', 'high', 'medium', 'low']),
    category: MamEntityIdSchema,
    summary: z.string().min(1).max(4000),
    evidence: z.array(ArtifactRefSchema),
    filePath: z.string().min(1).optional(),
    line: z.number().int().positive().optional()
  })
  .strict()

export const ReviewDecisionSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    id: MamEntityIdSchema,
    workflowRunId: MamEntityIdSchema,
    reviewNodeId: MamEntityIdSchema,
    attemptId: MamEntityIdSchema,
    subject: ReviewSubjectSchema,
    reviewerTaskId: MamEntityIdSchema,
    reviewerAttemptId: MamEntityIdSchema,
    reviewerRoleInstanceId: MamEntityIdSchema,
    status: z.enum(['approved', 'changes_requested', 'blocked']),
    findings: z.array(ReviewFindingSchema),
    summary: z.string().min(1).max(4000),
    createdAt: IsoTimestampSchema
  })
  .strict()
  .superRefine((decision, context) => {
    if (decision.subject.attemptId !== decision.attemptId) {
      context.addIssue({ code: 'custom', path: ['subject'], message: 'review subject mismatch' })
    }
    if (decision.findings.some((finding) => finding.attemptId !== decision.attemptId)) {
      context.addIssue({ code: 'custom', path: ['findings'], message: 'finding target mismatch' })
    }
    if (decision.status === 'changes_requested' && decision.findings.length === 0) {
      context.addIssue({ code: 'custom', path: ['findings'], message: 'changes require findings' })
    }
    if (
      decision.status === 'approved' &&
      decision.findings.some(
        (finding) => finding.severity === 'blocker' || finding.severity === 'high'
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['findings'],
        message: 'approval has blocking findings'
      })
    }
  })

export const ReviewPanelAssignmentSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    id: MamEntityIdSchema,
    workflowRunId: MamEntityIdSchema,
    reviewNodeId: MamEntityIdSchema,
    attemptId: MamEntityIdSchema,
    subject: ReviewSubjectSchema,
    reviewerTaskId: MamEntityIdSchema,
    reviewerAttemptId: MamEntityIdSchema,
    roleProfileId: MamEntityIdSchema,
    roleProfileVersion: z.number().int().positive(),
    roleInstanceId: MamEntityIdSchema,
    executorInvocationId: MamEntityIdSchema,
    status: z.enum(['running', 'submitted', 'timed_out', 'failed']),
    decision: ReviewDecisionSchema.optional(),
    artifact: ArtifactRefSchema.optional(),
    startedAt: IsoTimestampSchema,
    completedAt: IsoTimestampSchema.optional()
  })
  .strict()
  .superRefine((assignment, context) => {
    if (assignment.subject.attemptId !== assignment.attemptId) {
      context.addIssue({ code: 'custom', message: 'review assignment subject mismatch' })
    }
    if (
      assignment.decision &&
      (assignment.decision.workflowRunId !== assignment.workflowRunId ||
        assignment.decision.reviewNodeId !== assignment.reviewNodeId ||
        assignment.decision.attemptId !== assignment.attemptId ||
        assignment.decision.reviewerTaskId !== assignment.reviewerTaskId ||
        assignment.decision.reviewerAttemptId !== assignment.reviewerAttemptId ||
        assignment.decision.reviewerRoleInstanceId !== assignment.roleInstanceId ||
        JSON.stringify(assignment.decision.subject) !== JSON.stringify(assignment.subject))
    ) {
      context.addIssue({ code: 'custom', message: 'review decision assignment mismatch' })
    }
    if (assignment.status === 'submitted' && (!assignment.decision || !assignment.artifact)) {
      context.addIssue({
        code: 'custom',
        message: 'submitted review requires decision and artifact'
      })
    }
    if (assignment.status !== 'submitted' && (assignment.decision || assignment.artifact)) {
      context.addIssue({ code: 'custom', message: 'unsubmitted review cannot contain a result' })
    }
  })

export const ReviewAggregationSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    id: MamEntityIdSchema,
    workflowRunId: MamEntityIdSchema,
    reviewNodeId: MamEntityIdSchema,
    attemptId: MamEntityIdSchema,
    subject: ReviewSubjectSchema,
    classification: z.enum(['consensus', 'mergeable_disagreement', 'blocking_disagreement']),
    sourceDecisionIds: z.array(MamEntityIdSchema).min(1),
    findings: z.array(ReviewFindingSchema),
    proposedStatus: z.enum(['approved', 'changes_requested', 'blocked']),
    requiresHumanDecision: z.boolean(),
    createdAt: IsoTimestampSchema
  })
  .strict()
  .superRefine((aggregation, context) => {
    if (aggregation.subject.attemptId !== aggregation.attemptId) {
      context.addIssue({ code: 'custom', message: 'review aggregation subject mismatch' })
    }
    if (
      (aggregation.classification === 'blocking_disagreement') !==
      aggregation.requiresHumanDecision
    ) {
      context.addIssue({
        code: 'custom',
        message: 'blocking disagreement requires a human decision'
      })
    }
  })

export const ReviewDisagreementResolutionSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    aggregationId: MamEntityIdSchema,
    sourceDecisionIds: z.array(MamEntityIdSchema).min(1),
    commandId: MamEntityIdSchema,
    userId: MamEntityIdSchema,
    selectedOption: z.string().min(1).max(1000),
    resolvedAt: IsoTimestampSchema
  })
  .strict()

export const ReviewTaskDefinitionSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    id: MamEntityIdSchema,
    workflowRunId: MamEntityIdSchema,
    nodeRunId: MamEntityIdSchema,
    reviewNodeId: MamEntityIdSchema,
    subject: ReviewSubjectSchema,
    initialStatus: z.literal('waiting_role_assignment'),
    title: z.string().min(1).max(240),
    specification: z.string().min(1).max(20_000),
    inputArtifacts: z.array(ArtifactRefSchema),
    outputContracts: z.array(ArtifactContractSchema).min(1),
    recommendedRoleProfileIds: z.array(MamEntityIdSchema),
    allowedRoleProfileIds: z.array(MamEntityIdSchema).min(1)
  })
  .strict()

export type ReviewFinding = z.infer<typeof ReviewFindingSchema>
export type ReviewSubject = z.infer<typeof ReviewSubjectSchema>
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>
export type ReviewPanelAssignment = z.infer<typeof ReviewPanelAssignmentSchema>
export type ReviewAggregation = z.infer<typeof ReviewAggregationSchema>
export type ReviewDisagreementResolution = z.infer<typeof ReviewDisagreementResolutionSchema>
export type ReviewTaskDefinition = z.infer<typeof ReviewTaskDefinitionSchema>
