import { z } from 'zod'
import { RoleProfileSchema, type RoleProfile } from './domain/role'
import { MamEntityIdSchema, MamSchemaVersionSchema } from './domain/primitives'
import { WorkflowDefinitionSchema, type WorkflowDefinition } from './domain/workflow'

/** A portable Workflow definition and the Role versions it directly binds. */
export const MamWorkflowPackageSchema = z
  .object({
    schemaVersion: MamSchemaVersionSchema,
    workflow: WorkflowDefinitionSchema,
    roles: z.array(RoleProfileSchema)
  })
  .strict()
  .superRefine((pack, context) => {
    const roleIds = new Set(pack.roles.map((role) => role.id))
    const duplicateRoleIds = pack.roles.filter(
      (role, index) => pack.roles.findIndex((candidate) => candidate.id === role.id) !== index
    )
    if (duplicateRoleIds.length > 0) {
      context.addIssue({ code: 'custom', path: ['roles'], message: 'duplicate Role Profile IDs' })
    }
    for (const roleId of workflowRoleProfileIds(pack.workflow)) {
      if (!roleIds.has(roleId)) {
        context.addIssue({
          code: 'custom',
          path: ['roles'],
          message: `Workflow references missing Role Profile ${roleId}`
        })
      }
    }
  })

export type MamWorkflowPackage = z.infer<typeof MamWorkflowPackageSchema>

export function workflowRoleProfileIds(workflow: WorkflowDefinition): readonly string[] {
  const roleIds = new Set<string>()
  for (const node of workflow.nodes) {
    if ('allowedRoleProfileIds' in node) {
      for (const roleId of node.allowedRoleProfileIds) roleIds.add(roleId)
    }
    if ('recommendedRoleProfileIds' in node) {
      for (const roleId of node.recommendedRoleProfileIds) roleIds.add(roleId)
    }
  }
  return [...roleIds].sort((left, right) => left.localeCompare(right))
}

export function createMamWorkflowPackage(
  workflow: WorkflowDefinition,
  roles: readonly RoleProfile[]
): MamWorkflowPackage {
  return MamWorkflowPackageSchema.parse({
    schemaVersion: '1.0.0',
    workflow,
    roles: [...roles]
  })
}

export const MamExportWorkflowPackageInputSchema = z
  .object({
    definitionId: MamEntityIdSchema,
    definitionVersion: z.number().int().positive()
  })
  .strict()

export type MamExportWorkflowPackageInput = z.infer<typeof MamExportWorkflowPackageInputSchema>
