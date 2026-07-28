import { appendFile, chmod, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { redactPiRpcValue } from './pi-rpc-event-normalizer'

export class PiRpcLogWriter {
  private writeQueue = Promise.resolve()

  constructor(
    private readonly logPath: string,
    private readonly secrets: readonly string[] = [],
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  append(direction: 'event' | 'command' | 'stderr', payload: unknown): Promise<void> {
    const line = `${JSON.stringify(
      redactPiRpcValue({ timestamp: this.now(), direction, payload }, this.secrets)
    )}\n`
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.logPath), { recursive: true, mode: 0o700 })
      await appendFile(this.logPath, line, { encoding: 'utf8', mode: 0o600 })
      await chmod(this.logPath, 0o600)
    })
    return this.writeQueue
  }

  flush(): Promise<void> {
    return this.writeQueue
  }
}
