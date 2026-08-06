import { z } from 'zod'
import { MamEntityIdSchema } from './domain/primitives'
import { WorkflowDefinitionSchema } from './domain/workflow'
import { RoleProfileSchema } from './domain/role'
import {
  ExecutorProfileSchema,
  ModelProfileSchema,
  ProviderProfileSchema
} from './domain/execution-profile'
import { KnowledgeBaseProfileSchema, McpServerProfileSchema } from './domain/resource-profile'
import { MamSkillDefinitionSchema } from './domain/skill-definition'
import { MamLocalSettingsSchema } from './local-settings'
import { ArtifactRefSchema } from './domain/artifact'
import { MamModelConnectionProtocolSchema } from './model-catalog'
import { MamExportWorkflowPackageInputSchema } from './workflow-package'
import { HumanAnswerSchema } from './domain/human-attention'
import { ReviewSubjectSchema } from './domain/review'

export const MamSaveModelConnectionInputSchema = z
  .object({
    displayName: z.string().trim().min(1).max(160),
    protocol: MamModelConnectionProtocolSchema,
    baseUrl: z.url().optional(),
    apiKey: z.string().trim().min(1).max(20_000).optional(),
    remoteModelId: z.string().trim().min(1).max(400)
  })
  .strict()

export const MamDeleteRoleProfileInputSchema = z
  .object({ roleProfileId: MamEntityIdSchema })
  .strict()

export const MamDeleteWorkflowInputSchema = z.object({ definitionId: MamEntityIdSchema }).strict()

export { MamExportWorkflowPackageInputSchema }

export const MamCancelWorkflowRunInputSchema = z
  .object({ workflowRunId: MamEntityIdSchema })
  .strict()

export const MamRestartWorkflowRunInputSchema = z
  .object({ workflowRunId: MamEntityIdSchema })
  .strict()

export const MamAssignTaskInputSchema = z
  .object({
    workflowRunId: MamEntityIdSchema,
    taskId: MamEntityIdSchema,
    roleProfileId: MamEntityIdSchema,
    roleProfileVersion: z.number().int().positive()
  })
  .strict()

export const MamReassignTaskInputSchema = z
  .object({
    workflowRunId: MamEntityIdSchema,
    taskId: MamEntityIdSchema,
    previousRoleProfileId: MamEntityIdSchema,
    previousRoleProfileVersion: z.number().int().positive(),
    roleProfileId: MamEntityIdSchema,
    roleProfileVersion: z.number().int().positive()
  })
  .strict()

export const MamRecoverAttemptInputSchema = z
  .object({
    workflowRunId: MamEntityIdSchema,
    taskId: MamEntityIdSchema,
    previousAttemptId: MamEntityIdSchema,
    resolution: z.enum(['start_new_attempt', 'needs_reconciliation']),
    reason: z.string().min(1).max(4000)
  })
  .strict()

export const MamStartAttemptInputSchema = z
  .object({
    workflowRunId: MamEntityIdSchema,
    taskId: MamEntityIdSchema
  })
  .strict()

export const MamExecuteNextMergeInputSchema = z
  .object({ workflowRunId: MamEntityIdSchema })
  .strict()

export const MamSaveWorkflowInputSchema = z
  .object({ definition: WorkflowDefinitionSchema })
  .strict()

export const MamCreateWorkflowRunInputSchema = z
  .object({
    definitionId: MamEntityIdSchema,
    definitionVersion: z.number().int().positive(),
    inputArtifacts: z.array(ArtifactRefSchema)
  })
  .strict()

export const MamSubmitReviewInputSchema = z
  .object({
    workflowRunId: MamEntityIdSchema,
    reviewerTaskId: MamEntityIdSchema,
    reviewerAttemptId: MamEntityIdSchema,
    status: z.enum(['approved', 'changes_requested', 'blocked']),
    summary: z.string().min(1).max(4000),
    findings: z.array(
      z
        .object({
          severity: z.enum(['blocker', 'high', 'medium', 'low']),
          category: MamEntityIdSchema,
          summary: z.string().min(1).max(4000),
          filePath: z.string().min(1).optional(),
          line: z.number().int().positive().optional()
        })
        .strict()
    )
  })
  .strict()
  .superRefine((input, context) => {
    if (input.status === 'changes_requested' && input.findings.length === 0) {
      context.addIssue({ code: 'custom', path: ['findings'], message: 'changes require findings' })
    }
  })

export const MamResolveReviewDisagreementInputSchema = z
  .object({
    workflowRunId: MamEntityIdSchema,
    aggregationId: MamEntityIdSchema,
    selectedStatus: z.enum(['approved', 'changes_requested', 'blocked'])
  })
  .strict()

export const MamResolveApprovalGateInputSchema = z
  .object({
    workflowRunId: MamEntityIdSchema,
    gateId: MamEntityIdSchema,
    option: z.string().min(1).max(1000)
  })
  .strict()

export const MamAnswerHumanQuestionsInputSchema = z
  .object({
    workflowRunId: MamEntityIdSchema,
    taskId: MamEntityIdSchema,
    interactionId: MamEntityIdSchema,
    batchId: MamEntityIdSchema,
    answers: z.array(HumanAnswerSchema).min(1).max(5)
  })
  .strict()

export const MamConfirmHumanUnderstandingInputSchema = z
  .object({
    workflowRunId: MamEntityIdSchema,
    taskId: MamEntityIdSchema,
    interactionId: MamEntityIdSchema
  })
  .strict()

export const MamReviseHumanUnderstandingInputSchema = z
  .object({
    workflowRunId: MamEntityIdSchema,
    taskId: MamEntityIdSchema,
    interactionId: MamEntityIdSchema,
    feedback: z.string().trim().min(1).max(20_000)
  })
  .strict()

export const MamResolveHumanReviewInputSchema = z
  .object({
    workflowRunId: MamEntityIdSchema,
    taskId: MamEntityIdSchema,
    gateNodeId: MamEntityIdSchema,
    subject: ReviewSubjectSchema,
    status: z.enum(['approved', 'changes_requested', 'blocked']),
    feedback: z.string().trim().max(20_000).optional()
  })
  .strict()
  .superRefine((input, context) => {
    if (input.status !== 'approved' && !input.feedback) {
      context.addIssue({ code: 'custom', path: ['feedback'], message: 'feedback is required' })
    }
  })

export const MamSelectAttemptInputSchema = z
  .object({
    workflowRunId: MamEntityIdSchema,
    taskId: MamEntityIdSchema,
    attemptId: MamEntityIdSchema
  })
  .strict()

export const MamSaveProfileInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('role'), profile: RoleProfileSchema }).strict(),
  z.object({ kind: z.literal('executor'), profile: ExecutorProfileSchema }).strict(),
  z.object({ kind: z.literal('provider'), profile: ProviderProfileSchema }).strict(),
  z.object({ kind: z.literal('model'), profile: ModelProfileSchema }).strict(),
  z.object({ kind: z.literal('skill'), profile: MamSkillDefinitionSchema }).strict(),
  z.object({ kind: z.literal('mcp'), profile: McpServerProfileSchema }).strict(),
  z.object({ kind: z.literal('knowledge'), profile: KnowledgeBaseProfileSchema }).strict()
])

export const MamSaveLocalSettingsInputSchema = z
  .object({ settings: MamLocalSettingsSchema })
  .strict()

export type MamAssignTaskInput = z.infer<typeof MamAssignTaskInputSchema>
export type MamReassignTaskInput = z.infer<typeof MamReassignTaskInputSchema>
export type MamRecoverAttemptInput = z.infer<typeof MamRecoverAttemptInputSchema>
export type MamStartAttemptInput = z.infer<typeof MamStartAttemptInputSchema>
export type MamExecuteNextMergeInput = z.infer<typeof MamExecuteNextMergeInputSchema>
export type MamSaveWorkflowInput = z.infer<typeof MamSaveWorkflowInputSchema>
export type MamCreateWorkflowRunInput = z.infer<typeof MamCreateWorkflowRunInputSchema>
export type MamSubmitReviewInput = z.infer<typeof MamSubmitReviewInputSchema>
export type MamResolveReviewDisagreementInput = z.infer<
  typeof MamResolveReviewDisagreementInputSchema
>
export type MamResolveApprovalGateInput = z.infer<typeof MamResolveApprovalGateInputSchema>
export type MamAnswerHumanQuestionsInput = z.infer<typeof MamAnswerHumanQuestionsInputSchema>
export type MamConfirmHumanUnderstandingInput = z.infer<
  typeof MamConfirmHumanUnderstandingInputSchema
>
export type MamReviseHumanUnderstandingInput = z.infer<
  typeof MamReviseHumanUnderstandingInputSchema
>
export type MamResolveHumanReviewInput = z.infer<typeof MamResolveHumanReviewInputSchema>
export type MamSelectAttemptInput = z.infer<typeof MamSelectAttemptInputSchema>
export type MamSaveProfileInput = z.infer<typeof MamSaveProfileInputSchema>
export type MamSaveLocalSettingsInput = z.infer<typeof MamSaveLocalSettingsInputSchema>
export type MamSaveModelConnectionInput = z.infer<typeof MamSaveModelConnectionInputSchema>
export type MamDeleteRoleProfileInput = z.infer<typeof MamDeleteRoleProfileInputSchema>
export type MamDeleteWorkflowInput = z.infer<typeof MamDeleteWorkflowInputSchema>
export type MamExportWorkflowPackageInput = z.infer<typeof MamExportWorkflowPackageInputSchema>
export type MamCancelWorkflowRunInput = z.infer<typeof MamCancelWorkflowRunInputSchema>
export type MamRestartWorkflowRunInput = z.infer<typeof MamRestartWorkflowRunInputSchema>
