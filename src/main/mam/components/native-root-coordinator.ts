import { realpathSync } from 'node:fs'
import { resolve, dirname, basename, join } from 'node:path'
type State = { busy: boolean; pins: Map<string, number> }
const roots = new Map<string, State>()
function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = dirname(path)
    if (parent === path) throw error
    return join(canonical(parent), basename(path))
  }
}
export function nativeRootCoordinator(root: string): State {
  const path = canonical(resolve(root)),
    key = process.platform === 'win32' ? path.toLowerCase() : path
  let state = roots.get(key)
  if (!state) {
    state = { busy: false, pins: new Map() }
    roots.set(key, state)
  }
  return state
}
