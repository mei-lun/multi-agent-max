import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export type DesktopRuntimeLogDetails = Readonly<Record<string, unknown>>

export class DesktopRuntimeLogger {
  private heartbeatTimer: NodeJS.Timeout | undefined

  constructor(
    private readonly storagePath: string,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  record(scope: string, event: string, details: DesktopRuntimeLogDetails = {}): void {
    const entry = redactRuntimeLog({
      schemaVersion: '1.0.0',
      at: this.now(),
      pid: process.pid,
      scope,
      event,
      details
    })
    try {
      const path = resolve(this.storagePath)
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      appendFileSync(path, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
    } catch {
      // Diagnostics must never make the application command fail.
    }
  }

  startHeartbeat(intervalMs = 1_000): () => void {
    let previousAt = Date.now()
    this.heartbeatTimer = setInterval(() => {
      const currentAt = Date.now()
      this.record('main', 'heartbeat', {
        intervalMs,
        lagMs: Math.max(0, currentAt - previousAt - intervalMs)
      })
      previousAt = currentAt
    }, intervalMs)
    this.heartbeatTimer.unref()
    return () => {
      if (!this.heartbeatTimer) return
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = undefined
    }
  }
}

function redactRuntimeLog(value: unknown, key?: string): unknown {
  if (typeof value === 'string') {
    if (key && /api[_-]?key|token|authorization|secret|password|credential/i.test(key)) {
      return '[REDACTED]'
    }
    return value
      .replace(
        /(api[_-]?key|token|authorization|secret|password)(\s*[:=]\s*)[^\s,]+/gi,
        '$1$2[REDACTED]'
      )
      .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
  }
  if (Array.isArray(value)) return value.map((entry) => redactRuntimeLog(entry, key))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entry]) => [
        entryKey,
        redactRuntimeLog(entry, entryKey)
      ])
    )
  }
  return value
}
