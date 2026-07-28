import { z } from 'zod'
import {
  AttemptResultSchema,
  AttemptResultArtifactSchema,
  AttemptVerificationSchema,
  type AttemptResult
} from '../../../shared/mam/domain/attempt-result'
import {
  IsoTimestampSchema,
  MamEntityIdSchema,
  Sha256Schema
} from '../../../shared/mam/domain/primitives'

export const AgentAttemptResultPayloadSchema = z
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
    diagnosticsRef: z.string().min(1).optional()
  })
  .strict()

export const AttemptResultAuthoritySchema = z
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

export type AgentAttemptResultPayload = z.infer<typeof AgentAttemptResultPayloadSchema>
export type AttemptResultAuthority = z.infer<typeof AttemptResultAuthoritySchema>

export function agentAttemptResultJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(AgentAttemptResultPayloadSchema, { target: 'draft-7' }) as Record<
    string,
    unknown
  >
}

export function buildAttemptResult(
  payloadInput: unknown,
  authorityInput: AttemptResultAuthority
): AttemptResult {
  const payload = AgentAttemptResultPayloadSchema.parse(payloadInput)
  const authority = AttemptResultAuthoritySchema.parse(authorityInput)
  return AttemptResultSchema.parse({ ...payload, system: authority })
}
