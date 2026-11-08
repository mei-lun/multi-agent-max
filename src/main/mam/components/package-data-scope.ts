import { createHash } from 'node:crypto'
import { join } from 'node:path'

/** Host-owned project identity selects native data; resource installations stay outside this scope. */
export function packageDataScope(
  root: string,
  projectId: string,
  attemptScope?: string,
  catalog = false
) {
  if (catalog) return { key: 'catalog', root: join(root, 'package-catalog') }
  if (attemptScope) {
    const hash = createHash('sha256').update(attemptScope).digest('hex')
    return { key: hash, root: join(root, 'package-scopes', hash) }
  }
  // Existing standalone drafts/history retain their original location.
  if (projectId === 'creative.local') return { key: 'manual', root }
  const hash = createHash('sha256').update(projectId).digest('hex')
  return { key: `project-${hash}`, root: join(root, 'package-projects', hash) }
}
