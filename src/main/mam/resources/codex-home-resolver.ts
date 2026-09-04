import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export function resolveCodexHome(explicit?: string): string {
  return resolve(explicit ?? process.env.CODEX_HOME ?? join(homedir(), '.codex'))
}
