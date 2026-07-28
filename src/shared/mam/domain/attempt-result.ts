import { z } from 'zod'
import { IsoTimestampSchema, MamEntityIdSchema, Sha256Schema } from './primitives'

export const AttemptVerificationSchema = z
  .object({
    command: z.string().min(1),
    status: z.enum(['passed', 'failed', 'not_run']),
    summary: z.string().max(4000).optional()
  })
  .strict()

export const AttemptResultArtifactSchema = z
  .object({
    contractId: MamEntityIdSchema,
    type: MamEntityIdSchema,
    contentRef: z.string().min(1),
    sha256: Sha256Schema
  })
  .strict()

export const AttemptResultSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    status: z.enum(['submitted', 'blocked']),
    summary: z.string().min(1).max(20_000),
    verifications: z.array(AttemptVerificationSchema),
    risks: z.array(z.string().min(1).max(4000)),
    followUps: z.array(z.string().min(1).max(4000)),
    artifacts: z.array(AttemptResultArtifactSchema),
    usage: z
      .object({
        status: z.enum(['known', 'partial', 'unknown']),
        inputTokens: z.number().int().nonnegative().optional(),
        outputTokens: z.number().int().nonnegative().optional(),
        costUsd: z.number().nonnegative().optional()
      })
      .strict(),
    diagnosticsRef: z.string().min(1).optional(),
    system: z
      .object({
        workflowRunId: MamEntityIdSchema,
        nodeRunId: MamEntityIdSchema,
        taskId: MamEntityIdSchema,
        attemptId: MamEntityIdSchema,
        roleInstanceId: MamEntityIdSchema,
        executorInvocationId: MamEntityIdSchema,
        effectiveConfigHash: Sha256Schema,
        submittedCommit: z.string().min(7).optional(),
        createdAt: IsoTimestampSchema
      })
      .strict()
  })
  .strict()

export type AttemptResult = z.infer<typeof AttemptResultSchema>
