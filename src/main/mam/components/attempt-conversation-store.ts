import { join } from 'node:path'
import { atomicJson, safeDirectory } from '../creative-runtime/storage'

// All callback instances share the host's lock; the service root itself has an exclusive owner.
const activeTurns = new Set<string>()
export async function acquireConversationTurn(directory: string, id: string) {
  const path = join(await safeDirectory(directory), `${id}.json`)
  const key = process.platform === 'win32' ? path.toLowerCase() : path
  if (activeTurns.has(key)) throw new Error('Graph conversation turn already running')
  activeTurns.add(key)
  return {
    path,
    save: (turns: string[]) => atomicJson(path, turns),
    release: () => {
      activeTurns.delete(key)
    }
  }
}
