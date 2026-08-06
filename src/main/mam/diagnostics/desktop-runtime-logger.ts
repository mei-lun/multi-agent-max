import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export type DesktopRuntimeLogDetails = Readonly<Record<string, unknown>>

const DEFAULT_MAX_LOG_BYTES = 5 * 1024 * 1024
const HEALTHY_HEARTBEAT_SAMPLE_TICKS = 60
const HEARTBEAT_LAG_THRESHOLD_MS = 250

export class DesktopRuntimeLogger {
  private heartbeatTimer: NodeJS.Timeout | undefined
  private currentBytes: number

  constructor(
    private readonly storagePath: string,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly maxLogBytes = DEFAULT_MAX_LOG_BYTES
  ) {
    this.currentBytes = fileSize(storagePath)
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
      const lineBytes = Buffer.byteLength(line)
      if (this.currentBytes > 0 && this.currentBytes + lineBytes > this.maxLogBytes) {
        this.rotate(path)
      }
      appendFileSync(path, line, { mode: 0o600 })
      this.currentBytes += lineBytes
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

  private rotate(path: string): void {
    if (!existsSync(path)) {
      this.currentBytes = 0
      return
    }
    const backupPath = `${path}.1`
    rmSync(backupPath, { force: true })
    renameSync(path, backupPath)
    this.currentBytes = 0
  }
}

function fileSize(pathInput: string): number {
  try {
    return statSync(resolve(pathInput)).size
  } catch {
    return 0
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
