import { z } from 'zod'
import {
  IsoTimestampSchema,
  MamEntityIdSchema,
  MamSchemaVersionSchema,
  Sha256Schema
} from './primitives'

const WorkspaceArtifactIdentitySchema = z.object({
  schemaVersion: MamSchemaVersionSchema,
  id: MamEntityIdSchema,
  workflowRunId: MamEntityIdSchema,
  taskId: MamEntityIdSchema,
  attemptId: MamEntityIdSchema,
  roleInstanceId: MamEntityIdSchema,
  baseCommit: z.string().min(7),
  headCommit: z.string().min(7),
  contentHash: Sha256Schema,
  storageRef: z.string().min(1),
  createdAt: IsoTimestampSchema
})

export const WorkspaceArtifactFileSchema = z
  .object({
    path: z.string().min(1),
    previousPath: z.string().min(1).optional(),
    status: z.enum(['added', 'modified', 'deleted', 'renamed']),
    beforeHash: Sha256Schema.nullable(),
    afterHash: Sha256Schema.nullable(),
    patchHash: Sha256Schema
  })
  .strict()

export const DiffArtifactSchema = WorkspaceArtifactIdentitySchema.extend({
  kind: z.literal('diff'),
  files: z.array(WorkspaceArtifactFileSchema),
  patch: z.string()
}).strict()

export const CommitArtifactSchema = WorkspaceArtifactIdentitySchema.extend({
  kind: z.literal('commit'),
  commit: z.string().min(7),
  message: z.string().min(1),
  files: z.array(WorkspaceArtifactFileSchema),
  patch: z.string()
}).strict()

export type WorkspaceArtifactFile = z.infer<typeof WorkspaceArtifactFileSchema>
export type DiffArtifact = z.infer<typeof DiffArtifactSchema>
export type CommitArtifact = z.infer<typeof CommitArtifactSchema>
