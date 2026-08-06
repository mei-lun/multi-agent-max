import { z } from 'zod'
import {
  HumanAnswerSchema,
  HumanReviewDecisionSchema,
  HumanQuestionBatchSchema
} from './domain/human-attention'
import { MamEntityIdSchema } from './domain/primitives'
import { ReviewSubjectSchema } from './domain/review'

export function createHumanAttentionCommandSchemas<T extends z.ZodRawShape>(taskEnvelope: T) {
  return [
    z
      .object({
        ...taskEnvelope,
        type: z.literal('request_human_input'),
        attemptId: MamEntityIdSchema,
        interactionId: MamEntityIdSchema,
        scope: z.enum(['task', 'branch', 'run']),
        kind: z.enum(['role_questions', 'revision_consultation']),
        batch: HumanQuestionBatchSchema
      })
      .strict(),
    z
      .object({
        ...taskEnvelope,
        type: z.literal('answer_human_questions'),
        interactionId: MamEntityIdSchema,
        batchId: MamEntityIdSchema,
        answers: z.array(HumanAnswerSchema).min(1).max(5)
      })
      .strict(),
    z
      .object({
        ...taskEnvelope,
        type: z.literal('submit_human_understanding'),
        attemptId: MamEntityIdSchema,
        interactionId: MamEntityIdSchema,
        summary: z.string().trim().min(1).max(20_000)
      })
      .strict(),
    z
      .object({
        ...taskEnvelope,
        type: z.literal('confirm_human_understanding'),
        interactionId: MamEntityIdSchema
      })
      .strict(),
    z
      .object({
        ...taskEnvelope,
        type: z.literal('revise_human_understanding'),
        interactionId: MamEntityIdSchema,
        feedback: z.string().trim().min(1).max(20_000)
      })
      .strict(),
    z
      .object({
        ...taskEnvelope,
        type: z.literal('resolve_human_review'),
        gateNodeId: MamEntityIdSchema,
        subject: ReviewSubjectSchema,
        status: z.enum(['approved', 'changes_requested', 'blocked']),
        feedback: z.string().trim().max(20_000).optional()
      })
      .strict()
  ] as const
}

export function createHumanAttentionEventSchemas<T extends z.ZodRawShape>(eventEnvelope: T) {
  return [
    z
      .object({
        ...eventEnvelope,
        type: z.literal('human_input_requested'),
        taskId: MamEntityIdSchema,
        attemptId: MamEntityIdSchema,
        interactionId: MamEntityIdSchema,
        roleProfileId: MamEntityIdSchema,
        roleProfileVersion: z.number().int().positive(),
        roleInstanceId: MamEntityIdSchema,
        executorInvocationId: MamEntityIdSchema,
        scope: z.enum(['task', 'branch', 'run']),
        kind: z.enum(['role_questions', 'revision_consultation']),
        batch: HumanQuestionBatchSchema
      })
      .strict(),
    z
      .object({
        ...eventEnvelope,
        type: z.literal('human_questions_answered'),
        taskId: MamEntityIdSchema,
        interactionId: MamEntityIdSchema,
        batchId: MamEntityIdSchema,
        answers: z.array(HumanAnswerSchema).min(1).max(5),
        answeredByUserId: MamEntityIdSchema
      })
      .strict(),
    z
      .object({
        ...eventEnvelope,
        type: z.literal('human_understanding_submitted'),
        taskId: MamEntityIdSchema,
        attemptId: MamEntityIdSchema,
        interactionId: MamEntityIdSchema,
        summary: z.string().trim().min(1).max(20_000),
        roleInstanceId: MamEntityIdSchema,
        executorInvocationId: MamEntityIdSchema
      })
      .strict(),
    z
      .object({
        ...eventEnvelope,
        type: z.literal('human_understanding_confirmed'),
        taskId: MamEntityIdSchema,
        interactionId: MamEntityIdSchema,
        confirmedByUserId: MamEntityIdSchema
      })
      .strict(),
    z
      .object({
        ...eventEnvelope,
        type: z.literal('human_understanding_revision_requested'),
        taskId: MamEntityIdSchema,
        interactionId: MamEntityIdSchema,
        feedback: z.string().trim().min(1).max(20_000),
        requestedByUserId: MamEntityIdSchema
      })
      .strict(),
    z
      .object({
        ...eventEnvelope,
        type: z.literal('human_review_resolved'),
        taskId: MamEntityIdSchema,
        decision: HumanReviewDecisionSchema
      })
      .strict()
  ] as const
}
