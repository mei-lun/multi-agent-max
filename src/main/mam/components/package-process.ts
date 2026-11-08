import { execFile, fork, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { CreativeReconciliationRequired } from '../../../shared/mam/creative-runtime-errors'

export const IPC_LIMIT = 72 * 1024 * 1024
type Message = {
  type: string
  id: string
  call?: string
  method?: string
  value?: unknown
  error?: string
  code?: string
}
type Call = {
  resolve(value: unknown): void
  reject(error: Error): void
  rpc(method: string, value: unknown): Promise<unknown>
  cleanup(): void
}
/** Separate process, not an OS sandbox: only explicitly trusted installed packages may run. */
export class PackageProcess {
  private child: ChildProcess
  private calls = new Map<string, Call>()
  private closed = false
  private exited: Promise<void>
  private termination: Promise<void> | undefined
  private terminating = false
  private descendants = new Set<number>()
  constructor(
    entry: string,
    private graceMs = 10000
  ) {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|LANG)$/i.test(key)
      )
    )
    const settings = {
      execArgv: [],
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
      detached: process.platform !== 'win32',
      serialization: 'advanced' as const,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'] as ['ignore', 'ignore', 'ignore', 'ipc']
    }
    this.child = fork(entry, [], settings)
    this.exited = new Promise((resolve) =>
      this.child.once('close', () => {
        resolve()
        void this.terminate(
          new CreativeReconciliationRequired('Package process exited; reconcile external effects')
        )
      })
    )
    this.child.on('error', (error) => {
      void this.terminate(error)
    })
    this.child.on('message', (message) => {
      void this.receive(message).catch((error: Error) => {
        void this.terminate(error)
      })
    })
  }
  get alive() {
    return !this.closed && !this.terminating
  }
  private killTree(pid: number): Promise<void> {
    if (process.platform === 'win32')
      return new Promise((resolve) => {
        execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {
          try {
            process.kill(pid, 'SIGKILL')
          } catch {
            /* Already exited. */
          }
          resolve()
        })
      })
    try {
      process.kill(pid === this.child.pid ? -pid : pid, 'SIGKILL')
    } catch {
      /* Already exited. */
    }
    return Promise.resolve()
  }
  private terminate(
    error: Error = new CreativeReconciliationRequired('Package shutdown timed out')
  ): Promise<void> {
    if (this.termination) return this.termination
    this.terminating = true
    this.termination = (async () => {
      // Hold all invocation promises (and hence leases/GPU slots) through tree teardown.
      await Promise.all([...this.descendants].map((pid) => this.killTree(pid)))
      if (this.child.pid) await this.killTree(this.child.pid)
      await this.exited
      this.fail(error)
    })()
    return this.termination
  }
  private send(message: Message) {
    if (Buffer.byteLength(JSON.stringify(message)) > IPC_LIMIT)
      throw new Error('Package IPC size limit')
    if (!this.child.connected) throw new Error('Package process disconnected')
    this.child.send(message)
  }
  private fail(error: Error) {
    this.closed = true
    for (const call of this.calls.values()) {
      call.cleanup()
      call.reject(error)
    }
    this.calls.clear()
  }
  private async receive(raw: unknown) {
    if (!raw || typeof raw !== 'object' || Buffer.byteLength(JSON.stringify(raw)) > IPC_LIMIT)
      throw new Error('Invalid package IPC')
    const message = raw as Message,
      call = this.calls.get(message.id)
    if (message.type === 'descendant' || message.type === 'descendant-exit') {
      const pid = message.value
      if (!Number.isSafeInteger(pid) || Number(pid) <= 0 || Number(pid) === process.pid)
        throw new Error('Invalid descendant PID')
      if (message.type === 'descendant') this.descendants.add(Number(pid))
      else this.descendants.delete(Number(pid))
      return
    }
    if (this.terminating) return
    if (!call) return
    if (message.type === 'rpc') {
      if (!message.call || typeof message.method !== 'string')
        throw new Error('Invalid package capability call')
      try {
        this.send({
          type: 'reply',
          id: message.id,
          call: message.call,
          value: await call.rpc(message.method, message.value)
        })
      } catch (error) {
        if (this.alive)
          this.send({ type: 'reply', id: message.id, call: message.call, error: String(error) })
      }
    } else if (message.type === 'result') {
      this.calls.delete(message.id)
      call.cleanup()
      if (message.error)
        call.reject(
          message.code === 'creative_reconciliation_required'
            ? new CreativeReconciliationRequired(message.error)
            : new Error(message.error)
        )
      else call.resolve(message.value)
    } else throw new Error('Unknown package IPC message')
  }
  invoke(value: unknown, signal: AbortSignal, rpc: Call['rpc']): Promise<unknown> {
    signal.throwIfAborted()
    if (this.closed || this.calls.size >= 32)
      return Promise.reject(new Error('Package unavailable or concurrency limit'))
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const abort = () => {
        this.send({ type: 'cancel', id })
        timer = setTimeout(() => {
          void this.terminate(new CreativeReconciliationRequired('Package cancellation timed out'))
        }, this.graceMs)
      }
      this.calls.set(id, {
        resolve,
        reject,
        rpc,
        cleanup: () => {
          clearTimeout(timer)
          signal.removeEventListener('abort', abort)
        }
      })
      signal.addEventListener('abort', abort, { once: true })
      try {
        this.send({ type: 'run', id, value })
      } catch (error) {
        this.calls.get(id)?.cleanup()
        this.calls.delete(id)
        reject(error)
      }
    })
  }
  async dispose() {
    if (this.termination) return this.termination
    if (this.closed) return this.exited
    this.send({ type: 'dispose', id: 'dispose' })
    const timer = setTimeout(() => {
      void this.terminate()
    }, this.graceMs)
    try {
      await this.exited
      await this.termination
    } finally {
      clearTimeout(timer)
    }
  }
}
