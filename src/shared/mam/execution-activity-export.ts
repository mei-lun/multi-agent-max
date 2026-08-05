import { z } from 'zod'
import { MamEntityIdSchema } from './domain/primitives'

export const MamExportExecutionActivityInputSchema = z
  .object({
    workflowRunId: MamEntityIdSchema,
    nodeId: MamEntityIdSchema.optional()
  })
  .strict()

export type MamExportExecutionActivityInput = z.infer<typeof MamExportExecutionActivityInputSchema>
