import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { LOG_CLEANUP_INTERVAL_MS, pruneJsonLines } from './log-retention'

export type DesktopRuntimeLogDetails = Readonly<Record<string, unknown>>

const HEALTHY_HEARTBEAT_SAMPLE_TICKS = 60
const HEARTBEAT_LAG_THRESHOLD_MS = 250

export class DesktopRuntimeLogger {
  private heartbeatTimer: NodeJS.Timeout | undefined
  private lastCleanup = -Infinity

  constructor(
    private readonly storagePath: string,
    private readonly now: () => string = () => new Date().toISOString()
  ) {
    this.prune()
  }

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
      const line = `${JSON.stringify(entry)}\n`
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      if (Date.parse(this.now()) - this.lastCleanup >= LOG_CLEANUP_INTERVAL_MS) this.prune()
      appendFileSync(path, line, { mode: 0o600 })
    } catch {
      // Diagnostics must never make the application command fail.
    }
  }

  startHeartbeat(intervalMs = 1_000): () => void {
    let previousAt = Date.now()
    let healthyTicks = 0
    this.heartbeatTimer = setInterval(() => {
      const currentAt = Date.now()
      const lagMs = Math.max(0, currentAt - previousAt - intervalMs)
      healthyTicks += 1
      if (lagMs >= HEARTBEAT_LAG_THRESHOLD_MS || healthyTicks >= HEALTHY_HEARTBEAT_SAMPLE_TICKS) {
        this.record('main', 'heartbeat', { intervalMs, lagMs })
        healthyTicks = 0
      }
      previousAt = currentAt
    }, intervalMs)
    this.heartbeatTimer.unref()
    return () => {
      if (!this.heartbeatTimer) return
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = undefined
    }
  }

  prune(): void {
    try {
      this.lastCleanup = Date.parse(this.now())
      pruneJsonLines(this.storagePath, this.lastCleanup)
      pruneJsonLines(`${this.storagePath}.1`, this.lastCleanup)
    } catch {
      // Best-effort cleanup of local development logs.
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
      .replace(/\b(?:sk|xai|api)-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
      .replace(/mam-canary-secret-[A-Za-z0-9_-]+/g, '[REDACTED]')
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
