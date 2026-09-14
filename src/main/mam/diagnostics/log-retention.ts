import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const LOG_RETENTION_MS = 24 * 60 * 60 * 1000
export const LOG_CLEANUP_INTERVAL_MS = 60 * 1000

export function isRecentLog(at: unknown, now: number): boolean {
  return typeof at === 'string' && Date.parse(at) > now - LOG_RETENTION_MS
}

export function pruneJsonLines(path: string, now = Date.now()): void {
  if (!existsSync(path)) return
  const source = readFileSync(path, 'utf8')
  const retained = source.split('\n').filter((line) => {
    try {
      const entry = JSON.parse(line)
      return isRecentLog(entry?.at ?? entry?.timestamp, now)
    } catch {
      return false
    }
  })
  if (retained.length === 0) {
    rmSync(path, { force: true })
    return
  }
  const content = `${retained.join('\n')}\n`
  if (content !== source) writeFileSync(path, content, { mode: 0o600 })
}

export function prunePiRpcLogs(configRoots: readonly string[], now = Date.now()): void {
  for (const root of new Set(configRoots)) {
    const invocations = join(root, 'invocations')
    if (!existsSync(invocations)) continue
    for (const entry of readdirSync(invocations, { withFileTypes: true })) {
      if (entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name)) {
        pruneJsonLines(join(invocations, entry.name, 'rpc.jsonl'), now)
      }
    }
  }
}
