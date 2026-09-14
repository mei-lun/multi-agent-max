import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { isAbsolute, join, resolve } from 'node:path'
import { isRecentLog, pruneJsonLines, prunePiRpcLogs } from './log-retention'

// Remember previously used directories so switching destinations does not abandon their retention.
export function rememberLogDirectory(mamRoot: string, directory: string): readonly string[] {
  const path = join(mamRoot, 'log-directories.json')
  let saved: unknown = []
  try {
    if (existsSync(path)) saved = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    // Retention history is advisory and must not prevent opening the application.
  }
  const directories = [
    ...new Set(
      [
        join(mamRoot, 'diagnostics'),
        ...(Array.isArray(saved)
          ? saved.filter((item): item is string => typeof item === 'string' && isAbsolute(item))
          : []),
        directory
      ].map((item) => resolve(item))
    )
  ]
  try {
    mkdirSync(mamRoot, { recursive: true, mode: 0o700 })
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
    writeFileSync(temporaryPath, `${JSON.stringify(directories)}\n`, { mode: 0o600, flag: 'wx' })
    renameSync(temporaryPath, path)
  } catch {
    // Keep this session's cleanup paths even when their history cannot be saved.
  }
  return directories.filter((item) => item !== resolve(directory))
}

export function prunePreviousLogDirectory(directory: string, now = Date.now()): void {
  pruneJsonLines(join(directory, 'runtime.jsonl'), now)
  pruneJsonLines(join(directory, 'runtime.jsonl.1'), now)
  prunePiRpcLogs([directory], now)
  const eventsPath = join(directory, 'events.json')
  if (!existsSync(eventsPath)) return
  const events: unknown = JSON.parse(readFileSync(eventsPath, 'utf8'))
  if (!Array.isArray(events)) return
  const retained = events.filter((event) => isRecentLog(event?.at, now))
  if (retained.length !== events.length) {
    writeFileSync(eventsPath, `${JSON.stringify(retained, null, 2)}\n`, { mode: 0o600 })
  }
}
