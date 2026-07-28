import { z } from 'zod'
import { ExecutorKindSchema } from './domain/execution-profile'
import { IsoTimestampSchema, MamEntityIdSchema, MamSchemaVersionSchema } from './domain/primitives'

export const ExecutorUsageSchema = z
  .object({
    status: z.enum(['known', 'partial', 'unknown']),
    inputTokens: z.number().int().nonnegative().optional(),
    cachedInputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    costUsd: z.number().nonnegative().optional()
  })
  .strict()

export const ExecutorEventSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    type: z.enum([
      'invocation_started',
      'agent_message',
      'tool_event',
      'usage_updated',
      'invocation_completed',
      'invocation_failed'
    ]),
    timestamp: IsoTimestampSchema,
    executorKind: ExecutorKindSchema,
    executorInvocationId: MamEntityIdSchema,
    sourceEventType: z.string().min(1),
    payload: z.record(z.string(), z.unknown())
  })
  .strict()

export type ExecutorUsage = z.infer<typeof ExecutorUsageSchema>
export type ExecutorEvent = z.infer<typeof ExecutorEventSchema>
