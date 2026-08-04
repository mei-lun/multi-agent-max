import { z } from 'zod'
import { MamEntityIdSchema } from './domain/primitives'

export function createTaskAssignmentCommandSchemas<T extends z.ZodRawShape>(
  taskCommandEnvelope: T
) {
  return [
    z
      .object({
        ...taskCommandEnvelope,
        type: z.literal('assign_task'),
        roleProfileId: MamEntityIdSchema,
        roleProfileVersion: z.number().int().positive()
      })
      .strict(),
    z
      .object({
        ...taskCommandEnvelope,
        type: z.literal('reassign_task'),
        previousRoleProfileId: MamEntityIdSchema,
        previousRoleProfileVersion: z.number().int().positive(),
        roleProfileId: MamEntityIdSchema,
        roleProfileVersion: z.number().int().positive()
      })
      .strict()
  ] as const
}

export function createTaskAssignmentEventSchemas<T extends z.ZodRawShape>(eventEnvelope: T) {
  return [
    z
      .object({
        ...eventEnvelope,
        type: z.literal('task_assigned'),
        taskId: MamEntityIdSchema,
        roleProfileId: MamEntityIdSchema,
        roleProfileVersion: z.number().int().positive(),
        assignedByUserId: MamEntityIdSchema
      })
      .strict(),
    z
      .object({
        ...eventEnvelope,
        type: z.literal('task_reassigned'),
        taskId: MamEntityIdSchema,
        previousRoleProfileId: MamEntityIdSchema,
        previousRoleProfileVersion: z.number().int().positive(),
        roleProfileId: MamEntityIdSchema,
        roleProfileVersion: z.number().int().positive(),
        assignedByUserId: MamEntityIdSchema
      })
      .strict()
  ] as const
}
