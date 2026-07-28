import { z } from 'zod'
import {
  IsoTimestampSchema,
  MamEntityIdSchema,
  MamSchemaVersionSchema,
  Sha256Schema
} from './primitives'

export const ArtifactFormatSchema = z.enum([
  'json-schema',
  'markdown',
  'file-set',
  'diff',
  'test-report'
])

export const ArtifactContractSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    artifactType: MamEntityIdSchema,
    format: ArtifactFormatSchema,
    required: z.boolean().default(true),
    maxBytes: z
      .number()
      .int()
      .positive()
      .max(100 * 1024 * 1024),
    jsonSchema: z.record(z.string(), z.unknown()).optional(),
    requiredSections: z.array(MamEntityIdSchema).min(1).optional(),
    allowedGlobs: z.array(z.string().min(1)).min(1).optional()
  })
  .strict()
  .superRefine((contract, context) => {
    if (contract.format === 'json-schema' && contract.jsonSchema === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['jsonSchema'],
        message: 'json-schema artifacts require jsonSchema'
      })
    }
    if (contract.format === 'markdown' && contract.requiredSections === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['requiredSections'],
        message: 'markdown artifacts require requiredSections'
      })
    }
    if (contract.format === 'file-set' && contract.allowedGlobs === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['allowedGlobs'],
        message: 'file-set artifacts require allowedGlobs'
      })
    }
  })

export const ArtifactRefSchema = z.object({
  artifactId: MamEntityIdSchema,
  version: z.number().int().positive(),
  contentHash: Sha256Schema
})

export const ArtifactVersionSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    id: MamEntityIdSchema,
    artifactType: MamEntityIdSchema,
    version: z.number().int().positive(),
    workflowRunId: MamEntityIdSchema,
    nodeRunId: MamEntityIdSchema,
    taskId: MamEntityIdSchema,
    attemptId: MamEntityIdSchema,
    roleInstanceId: MamEntityIdSchema,
    format: ArtifactFormatSchema,
    contentHash: Sha256Schema,
    byteSize: z.number().int().nonnegative(),
    storageRef: z.string().min(1),
    availability: z.enum(['git', 'local', 'unavailable']),
    retention: z.string().min(1).optional(),
    inputs: z.array(ArtifactRefSchema),
    validationStatus: z.enum(['pending', 'valid', 'invalid']),
    createdAt: IsoTimestampSchema
  })
  .strict()

export type ArtifactContract = z.infer<typeof ArtifactContractSchema>
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>
export type ArtifactVersion = z.infer<typeof ArtifactVersionSchema>
