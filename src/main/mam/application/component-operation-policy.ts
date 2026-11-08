import type { PreparedAttempt } from './mam-attempt-execution-types'

/** Both workflow nodes and role tools use the frozen permission boundary. */
export function assertComponentOperation(
  snapshot: Pick<PreparedAttempt['snapshot'], 'tools' | 'componentBindings'>,
  componentId: string,
  operation: string
): void {
  if (!snapshot.tools.includes(`component:${componentId}`) || isComponentMaintenance(operation))
    throw new Error('component_permission_denied')
  const binding = snapshot.componentBindings?.find((item) => item.componentId === componentId)
  if (binding?.allowedOperations && !binding.allowedOperations.includes(operation))
    throw new Error('component_operation_denied')
}

export function isComponentMaintenance(operation: string): boolean {
  return /(^|\.)(resources|install|remove|offline|status|hardware)(\.|$)/.test(operation)
}
