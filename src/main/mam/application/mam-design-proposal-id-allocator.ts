import { createHash } from 'node:crypto'
import type { ProfileCatalog } from '../profiles/profile-catalog'
import type { MamDesignProposalIdAllocator } from './mam-design-proposal-materializer'

export function createMamDesignProposalIdAllocator(
  profiles: ProfileCatalog
): MamDesignProposalIdAllocator {
  const allocated = new Set<string>()
  return (kind, preferredId) => {
    const registry = kind === 'role' ? profiles.roles : profiles.workflows
    const base = boundedEntityId(preferredId)
    let id = base
    let suffix = 2
    while (allocated.has(id) || registry.listVersions(id).length > 0) {
      id = boundedEntityId(`${base}.${suffix}`)
      suffix += 1
    }
    allocated.add(id)
    return id
  }
}

function boundedEntityId(value: string): string {
  if (value.length <= 128) return value
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 12)
  return `${value.slice(0, 115)}.${digest}`
}
