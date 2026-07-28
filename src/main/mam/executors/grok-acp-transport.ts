import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import {
  GrokAcpNotificationSchema,
  assertGrokAcpResponse,
  type GrokAcpNotification,
  type GrokAcpResponse,
  type GrokAcpTransport
} from './grok-acp-protocol'

export type GrokAcpTransportOptions = Readonly<{
  command: string
  args: readonly string[]
  cwd: string
  env: Readonly<Record<string, string>>
  secrets?: readonly string[]
  requestTimeoutMs?: number
}>

type PendingRequest = Readonly<{
  resolve: (result: Record<string, unknown>) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}>

export class GrokAcpTransportError extends Error {
  constructor(
    readonly code: 'invalid_message' | 'process_exit' | 'request_timeout' | 'write_failed',
    message: string
  ) {
    super(message)
    this.name = 'GrokAcpTransportError'
  }
}

export class GrokAcpStdioTransport implements GrokAcpTransport {
  private child: ChildProcessWithoutNullStreams | undefined
  private nextRequestId = 1
  private stdoutBuffer = Buffer.alloc(0)
  private readonly stderrDecoder = new StringDecoder('utf8')
  private readonly pending = new Map<string | number, PendingRequest>()
  private readonly notifications = new Set<(notification: GrokAcpNotification) => void>()
  private readonly exits = new Set<(error?: Error) => void>()
  private stderr = ''

  constructor(private readonly options: GrokAcpTransportOptions) {}

  async start(): Promise<void> {
    if (this.child) return
    this.child = spawn(this.options.command, [...this.options.args], {
      cwd: this.options.cwd,
      env: { ...this.options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    this.child.stdout.on('data', (chunk: Buffer) => {
      try {
        this.consume(chunk)
      } catch (error) {
        this.failProtocol(error)
      }
    })
    this.child.stderr.on(
      'data',
      (chunk: Buffer) => (this.stderr += this.stderrDecoder.write(chunk))
    )
    this.child.once('error', (error) => this.failProcess(error))
    this.child.once('exit', (code, signal) => {
      this.stderr += this.stderrDecoder.end()
      const error =
        code === 0
          ? undefined
          : new GrokAcpTransportError(
              'process_exit',
              `Grok ACP process exited (${code ?? 'null'} ${signal ?? 'null'})`
            )
      this.failPending(
        error ??
          new GrokAcpTransportError('process_exit', 'Grok ACP process exited before responding')
      )
      for (const listener of this.exits) listener(error)
      this.child = undefined
    })
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child) return
    await new Promise<void>((resolvePromise) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolvePromise()
      }, 1000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolvePromise()
      })
      if (!child.kill()) {
        clearTimeout(timer)
        resolvePromise()
      }
    })
  }

  request(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const child = this.requireChild()
    const id = this.nextRequestId++
    const timeoutMs = this.options.requestTimeoutMs ?? 30_000
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new GrokAcpTransportError('request_timeout', `Grok ACP timed out: ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(
        frame({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }),
        (error) => {
          if (!error) return
          clearTimeout(timer)
          this.pending.delete(id)
          reject(new GrokAcpTransportError('write_failed', error.message))
        }
      )
    })
  }

  async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    const child = this.requireChild()
    await new Promise<void>((resolve, reject) => {
      child.stdin.write(frame({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }), (error) =>
        error ? reject(new GrokAcpTransportError('write_failed', error.message)) : resolve()
      )
    })
  }

  onNotification(listener: (notification: GrokAcpNotification) => void): () => void {
    this.notifications.add(listener)
    return () => this.notifications.delete(listener)
  }

  onExit(listener: (error?: Error) => void): () => void {
    this.exits.add(listener)
    return () => this.exits.delete(listener)
  }

  getStderr(): string {
    return redact(this.stderr, this.options.secrets ?? [])
  }

  private requireChild(): ChildProcessWithoutNullStreams {
    if (!this.child) throw new GrokAcpTransportError('process_exit', 'Grok ACP is not started')
    return this.child
  }

  private consume(chunk: Buffer): void {
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk])
    while (true) {
      const message = readMessage(this.stdoutBuffer)
      if (!message) return
      this.stdoutBuffer = this.stdoutBuffer.subarray(message.bytesRead)
      if (!message.body) continue
      const value = JSON.parse(message.body) as GrokAcpResponse | GrokAcpNotification
      if ('id' in value) {
        const pending = this.pending.get(value.id)
        if (!pending) continue
        clearTimeout(pending.timer)
        this.pending.delete(value.id)
        try {
          pending.resolve(assertGrokAcpResponse(value))
        } catch (error) {
          pending.reject(error instanceof Error ? error : new Error(String(error)))
        }
        continue
      }
      const notification = GrokAcpNotificationSchema.parse(value)
      for (const listener of this.notifications) listener(notification)
    }
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  private failProtocol(error: unknown): void {
    const transportError = new GrokAcpTransportError(
      'invalid_message',
      `Invalid Grok ACP message: ${error instanceof Error ? error.message : String(error)}`
    )
    this.failPending(transportError)
    this.child?.kill()
  }

  private failProcess(error: Error): void {
    const transportError = new GrokAcpTransportError('process_exit', error.message)
    this.failPending(transportError)
    for (const listener of this.exits) listener(transportError)
  }
}

function frame(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value)}\n`, 'utf8')
}

function readMessage(buffer: Buffer): { body: string; bytesRead: number } | undefined {
  const separator = buffer.indexOf('\r\n\r\n')
  if (separator !== -1) {
    const header = buffer.subarray(0, separator).toString('ascii')
    const match = header.match(/Content-Length:\s*(\d+)/i)
    if (!match) throw new Error('Grok ACP framing has no Content-Length')
    const length = Number(match[1])
    const start = separator + 4
    if (buffer.byteLength < start + length) return undefined
    return {
      body: buffer.subarray(start, start + length).toString('utf8'),
      bytesRead: start + length
    }
  }
  const newline = buffer.indexOf('\n')
  if (newline === -1) return undefined
  return { body: buffer.subarray(0, newline).toString('utf8').trim(), bytesRead: newline + 1 }
}

function redact(value: string, secrets: readonly string[]): string {
  let redacted = value
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/mam-canary-secret-[A-Za-z0-9_-]+/g, '[REDACTED]')
  for (const secret of secrets.filter(Boolean)) {
    redacted = redacted.replaceAll(secret, '[REDACTED]')
  }
  return redacted
}
