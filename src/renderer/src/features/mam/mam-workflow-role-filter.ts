import type { WorkflowDefinition } from '../../../../shared/mam/domain/workflow'

export function rolesForWorkflow<Role extends Readonly<{ id: string }>>(
  roles: readonly Role[],
  workflow?: WorkflowDefinition
): readonly Role[] {
  if (!workflow) return roles
  const roleIds = new Set(
    workflow.nodes.flatMap((node) =>
      'allowedRoleProfileIds' in node ? node.allowedRoleProfileIds : []
    )
  )
  return roles.filter((role) => roleIds.has(role.id))
}
