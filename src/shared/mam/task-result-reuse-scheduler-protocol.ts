import { z } from 'zod'
import { AttemptResultSchema } from './domain/attempt-result'
import { MamEntityIdSchema } from './domain/primitives'

const reusableTaskStatus = z.enum(['submitted', 'approved'])

const reusedTaskResultFields = {
  taskId: MamEntityIdSchema,
  sourceWorkflowRunId: MamEntityIdSchema,
  sourceTaskId: MamEntityIdSchema,
  sourceAttemptId: MamEntityIdSchema,
  sourceEventId: MamEntityIdSchema,
  sourceNodeId: MamEntityIdSchema,
  status: reusableTaskStatus,
  roleProfileId: MamEntityIdSchema,
  roleProfileVersion: z.number().int().positive(),
  result: AttemptResultSchema
}

export function createTaskResultReuseCommandSchema<T extends z.ZodRawShape>(commandEnvelope: T) {
  return z
    .object({
      ...commandEnvelope,
      type: z.literal('reuse_task_result'),
      ...reusedTaskResultFields
    })
    .strict()
}

export function createTaskResultReuseEventSchema<T extends z.ZodRawShape>(eventEnvelope: T) {
  return z
    .object({
      ...eventEnvelope,
      type: z.literal('task_result_reused'),
      ...reusedTaskResultFields
    })
    .strict()
}

export function createNodeCompletionReuseCommandSchema<T extends z.ZodRawShape>(
  commandEnvelope: T
) {
  return z
    .object({
      ...commandEnvelope,
      type: z.literal('reuse_node_completion'),
      nodeId: MamEntityIdSchema,
      sourceWorkflowRunId: MamEntityIdSchema,
      sourceNodeId: MamEntityIdSchema,
      sourceEvidenceId: MamEntityIdSchema
    })
    .strict()
}

export function createNodeCompletionReuseEventSchema<T extends z.ZodRawShape>(eventEnvelope: T) {
  return z
    .object({
      ...eventEnvelope,
      type: z.literal('node_completion_reused'),
      nodeId: MamEntityIdSchema,
      sourceWorkflowRunId: MamEntityIdSchema,
      sourceNodeId: MamEntityIdSchema,
      sourceEvidenceId: MamEntityIdSchema
    })
    .strict()
}
