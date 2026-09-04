import type { ResourceHealthResult } from '../../../../shared/mam/resource-health'

type HealthView = Readonly<{
  label: string
  variant: 'outline' | 'success' | 'destructive' | 'secondary'
  message?: string
  checkedAt?: string
}>

export function resourceHealthView(
  kind: ResourceHealthResult['kind'],
  resourceId: string,
  version: number,
  results: readonly ResourceHealthResult[]
): HealthView {
  const result = results.find(
    (item) => item.kind === kind && item.resourceId === resourceId && item.version === version
  )
  if (!result) return { label: 'Unchecked', variant: 'outline' }
  if (result.status === 'healthy') {
    return { label: 'Healthy', variant: 'success', checkedAt: result.checkedAt }
  }
  if (result.status === 'invalid') {
    return {
      label: 'Invalid',
      variant: 'destructive',
      ...(result.message ? { message: result.message } : {}),
      checkedAt: result.checkedAt
    }
  }
  return {
    label: 'Pi incompatible',
    variant: 'secondary',
    ...(result.message ? { message: result.message } : {}),
    checkedAt: result.checkedAt
  }
}
