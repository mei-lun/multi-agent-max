import { z } from 'zod'
import { IsoTimestampSchema, MamEntityIdSchema, Sha256Schema } from './domain/primitives'
import { RoleProfileSchema } from './domain/role'
import { WorkflowDefinitionSchema } from './domain/workflow'
import { MamDesignProposalSpecSchema, MamDesignReviewSchema } from './design-proposal'
import {
  MamDesignBrainstormDecisionSchema,
  MamDesignBrainstormStateSchema
} from './design-brainstorm'

export const MamDesignMessageSchema = z
  .object({
    id: MamEntityIdSchema,
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(20_000),
    createdAt: IsoTimestampSchema
  })
  .strict()

export const MamDesignValidationIssueSchema = z
  .object({
    code: z.string().min(1).max(200),
    severity: z.enum(['error', 'warning']),
    path: z.string().max(1000).optional(),
    message: z.string().min(1).max(4000)
  })
  .strict()

export const MamDesignProposalSchema = z
  .object({
    hash: Sha256Schema,
    roles: z.array(RoleProfileSchema).max(50),
    workflow: WorkflowDefinitionSchema,
    issues: z.array(MamDesignValidationIssueSchema),
    source: MamDesignProposalSpecSchema.optional(),
    createdAt: IsoTimestampSchema
  })
  .strict()

export const MamDesignWorkflowRevisionSchema = z
  .object({
    workflowId: MamEntityIdSchema,
    baseVersion: z.number().int().positive(),
    nextVersion: z.number().int().positive()
  })
  .strict()

export const MamDesignRecoverySchema = z
  .object({
    code: z.string().min(1).max(200),
    message: z.string().min(1).max(4_000),
    issues: z.array(MamDesignValidationIssueSchema).max(20),
    attempts: z.number().int().min(1).max(3),
    occurredAt: IsoTimestampSchema
  })
  .strict()

export const MamDesignDraftSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    id: MamEntityIdSchema,
    selectedModelProfileId: MamEntityIdSchema.optional(),
    workflowRevision: MamDesignWorkflowRevisionSchema.optional(),
    messages: z.array(MamDesignMessageSchema).max(200),
    proposal: MamDesignProposalSchema.optional(),
    brainstorm: MamDesignBrainstormStateSchema.optional(),
    review: MamDesignReviewSchema.optional(),
    recovery: MamDesignRecoverySchema.optional(),
    status: z.enum(['draft', 'applied']),
    appliedAt: IsoTimestampSchema.optional(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema
  })
  .strict()

export const MamDesignSendMessageInputSchema = z
  .object({
    requestId: MamEntityIdSchema,
    modelProfileId: MamEntityIdSchema,
    message: z.string().trim().min(1).max(20_000),
    decision: MamDesignBrainstormDecisionSchema.optional()
  })
  .strict()

export const MamDesignCancelInputSchema = z.object({ requestId: MamEntityIdSchema }).strict()

export const MamDesignSelectModelInputSchema = z
  .object({ modelProfileId: MamEntityIdSchema })
  .strict()

export const MamDesignResetInputSchema = z
  .object({
    modelProfileId: MamEntityIdSchema.optional(),
    workflowId: MamEntityIdSchema.optional()
  })
  .strict()

export const MamDesignCreateTemplateInputSchema = z
  .object({ modelProfileId: MamEntityIdSchema })
  .strict()

export const MamDesignRetryInputSchema = z.object({ requestId: MamEntityIdSchema }).strict()

export const MamDesignUpdateProposalInputSchema = z
  .object({
    expectedProposalHash: Sha256Schema,
    roles: z.array(RoleProfileSchema).max(50),
    workflow: WorkflowDefinitionSchema
  })
  .strict()

export const MamDesignApplyProposalInputSchema = z.object({ proposalHash: Sha256Schema }).strict()

export type MamDesignMessage = z.infer<typeof MamDesignMessageSchema>
export type MamDesignValidationIssue = z.infer<typeof MamDesignValidationIssueSchema>
export type MamDesignProposal = z.infer<typeof MamDesignProposalSchema>
export type MamDesignWorkflowRevision = z.infer<typeof MamDesignWorkflowRevisionSchema>
export type MamDesignRecovery = z.infer<typeof MamDesignRecoverySchema>
export type MamDesignDraft = z.infer<typeof MamDesignDraftSchema>
export type MamDesignSendMessageInput = z.infer<typeof MamDesignSendMessageInputSchema>
export type MamDesignCancelInput = z.infer<typeof MamDesignCancelInputSchema>
export type MamDesignSelectModelInput = z.infer<typeof MamDesignSelectModelInputSchema>
export type MamDesignResetInput = z.infer<typeof MamDesignResetInputSchema>
export type MamDesignCreateTemplateInput = z.infer<typeof MamDesignCreateTemplateInputSchema>
export type MamDesignRetryInput = z.infer<typeof MamDesignRetryInputSchema>
export type MamDesignUpdateProposalInput = z.infer<typeof MamDesignUpdateProposalInputSchema>
export type MamDesignApplyProposalInput = z.infer<typeof MamDesignApplyProposalInputSchema>
