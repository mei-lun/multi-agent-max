import { z } from 'zod'
import { ArtifactVersionSchema } from './artifact'
import { MamEntityIdSchema, MamSchemaVersionSchema, Sha256Schema } from './primitives'

export const SystemNodeExecutionSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    nodeId: MamEntityIdSchema,
    nodeType: z.enum(['artifact_transform', 'command']),
    status: z.enum(['passed', 'blocked']),
    artifacts: z.array(ArtifactVersionSchema),
    failureCode: z.string().min(1).max(200).optional(),
    commandEvidence: z
      .object({
        exitCode: z.number().int().nullable(),
        evidenceHash: Sha256Schema
      })
      .strict()
      .optional()
  })
  .strict()

export type SystemNodeExecution = z.infer<typeof SystemNodeExecutionSchema>
