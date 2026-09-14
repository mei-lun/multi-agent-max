import { appendFileSync } from 'node:fs'
import { chmod, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { compactPiRpcEvent, redactPiRpcValue } from './pi-rpc-event-normalizer'
import { LOG_CLEANUP_INTERVAL_MS, pruneJsonLines } from '../diagnostics/log-retention'

export class PiRpcLogWriter {
  private writeQueue = Promise.resolve()
  private lastCleanup = -Infinity

  constructor(
    private readonly logPath: string,
    private readonly secrets: readonly string[] = [],
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  append(direction: 'event' | 'command' | 'stderr', payload: unknown): Promise<void> {
    if (direction === 'event' && eventType(payload) === 'message_update') {
      return Promise.resolve()
    }
    const safePayload = direction === 'event' ? compactPiRpcEvent(payload) : payload
    const line = `${JSON.stringify(
      redactPiRpcValue({ timestamp: this.now(), direction, payload: safePayload }, this.secrets)
    )}\n`
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.logPath), { recursive: true, mode: 0o700 })
      // Keep the append synchronous so periodic retention cannot overwrite an in-flight write.
      const now = Date.parse(this.now())
      if (now - this.lastCleanup >= LOG_CLEANUP_INTERVAL_MS) {
        pruneJsonLines(this.logPath, now)
        this.lastCleanup = now
      }
      appendFileSync(this.logPath, line, { encoding: 'utf8', mode: 0o600 })
      await chmod(this.logPath, 0o600)
    })
    return this.writeQueue
  }

  flush(): Promise<void> {
    return this.writeQueue
  }
}

function eventType(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const type = (payload as { type?: unknown }).type
  return typeof type === 'string' ? type : undefined
}
