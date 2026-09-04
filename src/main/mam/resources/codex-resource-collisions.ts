import type { ResolvedCodexCandidate } from './codex-resource-discovery'

export function markResourceIdCollisions(
  resources: readonly ResolvedCodexCandidate[]
): ResolvedCodexCandidate[] {
  const counts = new Map<string, number>()
  for (const resource of resources) {
    const key = `${resource.candidate.kind}:${resource.candidate.resourceId}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return resources.map((resource) => {
    const key = `${resource.candidate.kind}:${resource.candidate.resourceId}`
    if (counts.get(key) === 1) return resource
    return {
      ...resource,
      candidate: {
        ...resource.candidate,
        importState: 'unavailable' as const,
        unavailableReason: 'Another Codex resource resolves to the same MAM ID.'
      }
    }
  })
}
