import { randomUUID } from 'node:crypto'
import { readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  CreativeJob,
  CreativeRequest,
  JobEvent,
  JobState
} from '../../../shared/mam/creative-runtime'
import {
  creativeRequestSchema,
  creativeJobSchema,
  jobEventSchema,
  type Reconciliation,
  type RuntimeDiagnostic
} from '../../../shared/mam/creative-runtime'
import { atomicJson, readSafe, safeDirectory } from './storage'

export type OperationHandler = {
  validate(request: CreativeRequest): void
  run(
    request: CreativeRequest,
    context: {
      signal: AbortSignal
      emit(type: 'usage' | 'asset' | 'log', data: unknown): Promise<void>
    }
  ): Promise<unknown>
}
export type HandlerRegistry = (request: CreativeRequest) => OperationHandler | undefined
const terminal = new Set<JobState>(['succeeded', 'failed', 'cancelled', 'reconciliation-required'])
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item
  )

export class CreativeJobManager {
  private jobs = new Map<string, CreativeJob>()
  private listeners = new Map<string, Set<(event: JobEvent) => void>>()
  private controllers = new Map<string, AbortController>()
  private queue: Promise<unknown> = Promise.resolve()
  private disposed = false
  private diagnostics: RuntimeDiagnostic[] = []
  health(): RuntimeDiagnostic[] {
    return structuredClone(this.diagnostics)
  }
  list(): CreativeJob[] {
    return [...this.jobs.values()].map((job) => structuredClone(job))
  }
  private constructor(
    private directory: string,
    private handlers: HandlerRegistry,
    private validateInputs?: (request: CreativeRequest) => Promise<void>
  ) {}
  static async open(options: {
    directory: string
    handlers: HandlerRegistry
    validateInputs?: (request: CreativeRequest) => Promise<void>
  }): Promise<CreativeJobManager> {
    const manager = new CreativeJobManager(
      await safeDirectory(options.directory),
      options.handlers,
      options.validateInputs
    )
    for (const file of await readdir(manager.directory)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(file)) continue
      const job = creativeJobSchema.parse(
        JSON.parse((await readSafe(join(manager.directory, file))).toString())
      ) as CreativeJob
      if (`${job.id}.json` !== file || !Array.isArray(job.events))
        throw new Error('Invalid persisted job')
      manager.jobs.set(job.id, job)
      if (!terminal.has(job.state))
        await manager.transition(job, 'reconciliation-required', {
          reason: 'Process interrupted; reconcile external effects before retry'
        })
    }
    return manager
  }
  private serialized<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action)
    this.queue = result.catch(() => {})
    return result
  }
  private async transition(
    job: CreativeJob,
    state: JobState,
    data?: unknown,
    type = state as string
  ): Promise<void> {
    const next = structuredClone(job)
    next.state = state
    const event: JobEvent = jobEventSchema.parse({
      sequence: next.events.length + 1,
      type,
      at: new Date().toISOString(),
      ...(data === undefined ? {} : { data })
    })
    next.events.push(event)
    try {
      await atomicJson(join(this.directory, `${job.id}.json`), next)
    } catch (error) {
      this.diagnostics.push({ jobId: job.id, message: String(error), at: new Date().toISOString() })
      throw error
    }
    Object.assign(job, next)
    for (const listener of this.listeners.get(job.id) ?? []) {
      try {
        listener(structuredClone(event))
      } catch {
        /* Observers cannot affect durable state. */
      }
    }
  }
  async submit(request: CreativeRequest): Promise<string> {
    return this.serialized(async () => {
      if (this.disposed) throw new Error('Manager disposed')
      if (this.diagnostics.length)
        throw new Error('Persistence unhealthy; restart and reconcile required')
      const snapshot = creativeRequestSchema.parse(request) as CreativeRequest
      if (
        ![
          snapshot.componentId,
          snapshot.componentVersion,
          snapshot.operation,
          snapshot.projectId,
          snapshot.idempotencyKey
        ].every((value) => typeof value === 'string' && value.length > 0) ||
        !Array.isArray(snapshot.inputAssets) ||
        !snapshot.params ||
        typeof snapshot.params !== 'object'
      )
        throw new Error('Invalid creative request')
      const prior = [...this.jobs.values()].find(
        (job) =>
          job.request.projectId === snapshot.projectId &&
          job.request.idempotencyKey === snapshot.idempotencyKey
      )
      if (prior) {
        if (canonical(prior.request) !== canonical(snapshot))
          throw new Error('Idempotency conflict')
        return prior.id
      }
      const handler = this.handlers(structuredClone(snapshot))
      if (!handler) throw new Error('Unsupported operation')
      handler.validate(structuredClone(snapshot))
      await this.validateInputs?.(structuredClone(snapshot))
      const job: CreativeJob = {
        id: randomUUID(),
        request: snapshot,
        state: 'accepted',
        events: []
      }
      await this.transition(job, 'accepted')
      this.jobs.set(job.id, job)
      setTimeout(() => {
        void this.execute(job, handler).catch((error) => {
          this.diagnostics.push({
            jobId: job.id,
            message: String(error),
            at: new Date().toISOString()
          })
        })
      }, 0)
      return job.id
    })
  }
  private async execute(job: CreativeJob, handler: OperationHandler): Promise<void> {
    const controller = new AbortController()
    const start = await this.serialized(async () => {
      if (this.disposed || job.state !== 'accepted') return false
      await this.transition(job, 'running')
      this.controllers.set(job.id, controller)
      return true
    })
    if (!start) return
    try {
      const result = await handler.run(structuredClone(job.request), {
        signal: controller.signal,
        emit: (type, data) =>
          this.serialized(async () => {
            if (!this.disposed && job.state === 'running')
              await this.transition(job, job.state, data, type)
          })
      })
      await this.serialized(async () => {
        if (this.disposed || terminal.has(job.state)) return
        await this.transition(
          job,
          job.state === 'cancel-requested' ? 'reconciliation-required' : 'succeeded',
          result
        )
      })
    } catch (error) {
      if (this.diagnostics.length) throw error
      await this.serialized(async () => {
        if (!this.disposed && !terminal.has(job.state))
          await this.transition(
            job,
            job.state === 'cancel-requested' ? 'reconciliation-required' : 'failed',
            { error: String(error) }
          )
      })
    } finally {
      this.controllers.delete(job.id)
    }
  }
  get(id: string): CreativeJob {
    const job = this.jobs.get(id)
    if (!job) throw new Error('Unknown job')
    return structuredClone(job)
  }
  async reconcile(
    id: string,
    evidence: Reconciliation,
    authorize: (job: CreativeJob, evidence: Reconciliation) => boolean
  ): Promise<void> {
    await this.serialized(async () => {
      if (this.disposed) throw new Error('Manager disposed')
      const job = this.jobs.get(id)
      if (!job || job.state !== 'reconciliation-required')
        throw new Error('Job does not require reconciliation')
      if (
        !['succeeded', 'failed', 'cancelled'].includes(evidence.outcome) ||
        !evidence.actor?.trim() ||
        !evidence.evidence?.trim()
      )
        throw new Error('Reconciliation evidence required')
      const snapshot = structuredClone(evidence)
      if (authorize(this.get(id), structuredClone(snapshot)) !== true)
        throw new Error('Reconciliation unauthorized')
      await this.transition(job, snapshot.outcome, snapshot, 'reconciled')
    })
  }
  events(id: string, afterSequence = 0): JobEvent[] {
    return this.get(id).events.filter((event) => event.sequence > afterSequence)
  }
  subscribe(id: string, afterSequence: number, listener: (event: JobEvent) => void): () => void {
    const events = this.events(id, afterSequence)
    const listeners = this.listeners.get(id) ?? new Set()
    listeners.add(listener)
    this.listeners.set(id, listeners)
    for (const event of events) listener(event)
    return () => {
      listeners.delete(listener)
    }
  }
  async cancel(id: string): Promise<void> {
    await this.serialized(async () => {
      if (this.disposed) throw new Error('Manager disposed')
      const job = this.jobs.get(id)
      if (!job) throw new Error('Unknown job')
      if (terminal.has(job.state) || job.state === 'cancel-requested') return
      await this.transition(job, job.state === 'accepted' ? 'cancelled' : 'cancel-requested')
      this.controllers.get(id)?.abort()
    })
  }
  async delete(id: string): Promise<void> {
    await this.serialized(async () => {
      if (this.disposed) throw new Error('Manager disposed')
      const job = this.get(id)
      if (!terminal.has(job.state)) throw new Error('Job is active')
      await unlink(join(this.directory, `${id}.json`))
      this.jobs.delete(id)
      this.listeners.delete(id)
    })
  }
  async dispose(): Promise<void> {
    await this.serialized(async () => {
      this.disposed = true
      for (const job of this.jobs.values())
        if (!terminal.has(job.state))
          await this.transition(job, 'reconciliation-required', { reason: 'Manager disposed' })
      for (const controller of this.controllers.values()) controller.abort()
      this.listeners.clear()
    })
  }
}
