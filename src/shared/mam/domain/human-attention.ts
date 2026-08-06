import { z } from 'zod'
import { IsoTimestampSchema, MamEntityIdSchema, MamSchemaVersionSchema } from './primitives'
import { ReviewSubjectSchema } from './review'

export const HumanQuestionOptionSchema = z
  .object({
    id: MamEntityIdSchema,
    label: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(2000),
    tradeoffs: z.string().trim().min(1).max(2000).optional()
  })
  .strict()

export const HumanQuestionSchema = z
  .object({
    id: MamEntityIdSchema,
    kind: z.enum(['decision', 'information']),
    question: z.string().trim().min(1).max(4000),
    whyItMatters: z.string().trim().min(1).max(4000),
    options: z.array(HumanQuestionOptionSchema).max(3).default([]),
    recommendedOptionId: MamEntityIdSchema.optional(),
    recommendationReason: z.string().trim().min(1).max(4000).optional()
  })
  .strict()
  .superRefine((question, context) => {
    if (question.kind === 'decision' && question.options.length < 2) {
      context.addIssue({ code: 'custom', path: ['options'], message: 'decision needs 2-3 options' })
    }
    if (question.kind === 'information' && question.options.length > 0) {
      context.addIssue({ code: 'custom', path: ['options'], message: 'information uses free text' })
    }
    const optionIds = new Set(question.options.map((option) => option.id))
    if (optionIds.size !== question.options.length) {
      context.addIssue({ code: 'custom', path: ['options'], message: 'option ids must be unique' })
    }
    if (question.kind === 'decision' && !question.recommendedOptionId) {
      context.addIssue({ code: 'custom', message: 'decision needs one recommendation' })
    }
    if (question.recommendedOptionId && !optionIds.has(question.recommendedOptionId)) {
      context.addIssue({ code: 'custom', message: 'recommendation must reference an option' })
    }
    if (question.kind === 'decision' && !question.recommendationReason) {
      context.addIssue({ code: 'custom', message: 'decision needs a recommendation reason' })
    }
  })

export const HumanQuestionBatchSchema = z
  .object({
    id: MamEntityIdSchema,
    title: z.string().trim().min(1).max(240),
    summary: z.string().trim().min(1).max(4000),
    questions: z.array(HumanQuestionSchema).min(1).max(5)
  })
  .strict()
  .superRefine((batch, context) => {
    if (new Set(batch.questions.map((question) => question.id)).size !== batch.questions.length) {
      context.addIssue({
        code: 'custom',
        path: ['questions'],
        message: 'question ids must be unique'
      })
    }
  })

export const HumanAnswerSchema = z
  .object({
    questionId: MamEntityIdSchema,
    selectedOptionId: MamEntityIdSchema.optional(),
    customAnswer: z.string().trim().min(1).max(20_000).optional()
  })
  .strict()
  .superRefine((answer, context) => {
    if (Boolean(answer.selectedOptionId) === Boolean(answer.customAnswer)) {
      context.addIssue({ code: 'custom', message: 'answer needs one option or custom text' })
    }
  })

export const HumanAnswerBatchSchema = z
  .object({
    batchId: MamEntityIdSchema,
    answers: z.array(HumanAnswerSchema).min(1).max(5),
    answeredByUserId: MamEntityIdSchema,
    answeredAt: IsoTimestampSchema
  })
  .strict()

export const HumanAttentionItemSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    id: MamEntityIdSchema,
    workflowRunId: MamEntityIdSchema,
    taskId: MamEntityIdSchema,
    attemptId: MamEntityIdSchema,
    roleProfileId: MamEntityIdSchema,
    roleProfileVersion: z.number().int().positive(),
    roleInstanceId: MamEntityIdSchema,
    scope: z.enum(['task', 'branch', 'run']),
    kind: z.enum(['role_questions', 'revision_consultation']),
    status: z.enum([
      'awaiting_human_answers',
      'agent_reviewing_answers',
      'ready_for_confirmation',
      'resolved',
      'blocked'
    ]),
    batches: z.array(HumanQuestionBatchSchema).min(1),
    answerBatches: z.array(HumanAnswerBatchSchema),
    understandingSummary: z.string().trim().min(1).max(20_000).optional(),
    understandingSummaries: z.array(
      z
        .object({ summary: z.string().trim().min(1).max(20_000), submittedAt: IsoTimestampSchema })
        .strict()
    ),
    understandingRevisions: z.array(
      z
        .object({
          feedback: z.string().trim().min(1).max(20_000),
          requestedByUserId: MamEntityIdSchema,
          requestedAt: IsoTimestampSchema
        })
        .strict()
    ),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    confirmedByUserId: MamEntityIdSchema.optional(),
    confirmedAt: IsoTimestampSchema.optional()
  })
  .strict()

export const HumanReviewDecisionSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    id: MamEntityIdSchema,
    workflowRunId: MamEntityIdSchema,
    gateNodeId: MamEntityIdSchema,
    revisionTargetNodeId: MamEntityIdSchema,
    revisionTargetTaskId: MamEntityIdSchema,
    subject: ReviewSubjectSchema,
    status: z.enum(['approved', 'changes_requested', 'blocked']),
    feedback: z.string().trim().max(20_000).optional(),
    decidedByUserId: MamEntityIdSchema,
    createdAt: IsoTimestampSchema
  })
  .strict()
  .superRefine((decision, context) => {
    if (decision.status !== 'approved' && !decision.feedback) {
      context.addIssue({ code: 'custom', path: ['feedback'], message: 'feedback is required' })
    }
  })

export type HumanQuestionBatch = z.infer<typeof HumanQuestionBatchSchema>
export type HumanAnswer = z.infer<typeof HumanAnswerSchema>
export type HumanAnswerBatch = z.infer<typeof HumanAnswerBatchSchema>
export type HumanAttentionItem = z.infer<typeof HumanAttentionItemSchema>
export type HumanReviewDecision = z.infer<typeof HumanReviewDecisionSchema>
