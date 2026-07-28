import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { MamEntityIdSchema } from '../../../shared/mam/domain/primitives'
import {
  EMPTY_SCHEDULER_REVISION,
  SchedulerEventSchema,
  type SchedulerEvent
} from '../../../shared/mam/scheduler-protocol'
import { isKernelEventBatch, type KernelEventBatch } from '../scheduler/kernel'

const EVENT_BATCH_SCHEMA_VERSION = '1.0.0'

type PersistedEventBatch = Readonly<{
  schemaVersion: typeof EVENT_BATCH_SCHEMA_VERSION
  expectedRevision: string
  events: readonly SchedulerEvent[]
}>

export class AppendOnlyEventStoreError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'AppendOnlyEventStoreError'
  }
}

export type AppendOnlyResult = Readonly<{
  revision: string
  appendedEventIds: readonly string[]
}>

export class AppendOnlyEventStore {
  private readonly rootDirectory: string

  constructor(rootDirectory: string) {
    this.rootDirectory = resolve(rootDirectory)
  }

  listEvents(workflowRunId: string): SchedulerEvent[] {
    return this.listBatches(workflowRunId).flatMap((batch) => [...batch.events])
  }

  listWorkflowRunIds(): readonly string[] {
    try {
      return readdirSync(join(this.rootDirectory, 'runs'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && MamEntityIdSchema.safeParse(entry.name).success)
        .map((entry) => entry.name)
        .sort()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  revision(workflowRunId: string): string {
    return hashEvents(this.listEvents(workflowRunId))
  }

  append(
    workflowRunId: string,
    batch: KernelEventBatch,
    expectedRevision: string
  ): AppendOnlyResult {
    if (!isKernelEventBatch(batch)) {
      throw new AppendOnlyEventStoreError(
        'scheduler_authority_required',
        'events must come from SchedulerKernel'
      )
    }
    const runId = MamEntityIdSchema.parse(workflowRunId)
    const existing = this.listEvents(runId)
    const currentRevision = hashEvents(existing)
    if (currentRevision !== expectedRevision) {
      throw new AppendOnlyEventStoreError(
        'parent_revision_mismatch',
        'expected parent revision is stale'
      )
    }
    const events = batch.events.map((event) => SchedulerEventSchema.parse(event))
    if (events.some((event) => event.workflowRunId !== runId)) {
      throw new AppendOnlyEventStoreError('run_binding_mismatch', 'event belongs to another run')
    }
    if (events.some((event) => event.parentRevision !== expectedRevision)) {
      throw new AppendOnlyEventStoreError(
        'event_parent_revision_mismatch',
        'event does not reference the expected revision'
      )
    }
    const ids = new Set(existing.map((event) => event.eventId))
    for (const event of events) {
      if (ids.has(event.eventId)) {
        throw new AppendOnlyEventStoreError(
          'duplicate_event_id',
          `duplicate event: ${event.eventId}`
        )
      }
      ids.add(event.eventId)
    }
    if (events.length === 0) {
      return { revision: currentRevision, appendedEventIds: [] }
    }
    const nextIndex = this.listBatchNames(runId).length + 1
    const persisted: PersistedEventBatch = {
      schemaVersion: EVENT_BATCH_SCHEMA_VERSION,
      expectedRevision,
      events
    }
    this.publishBatch(runId, nextIndex, persisted)
    const revision = hashEvents([...existing, ...events])
    this.writeSummary(runId, revision, existing.length + events.length)
    return { revision, appendedEventIds: events.map((event) => event.eventId) }
  }

  private listBatches(workflowRunId: string): PersistedEventBatch[] {
    return this.listBatchNames(MamEntityIdSchema.parse(workflowRunId)).map((name) => {
      try {
        const parsed = JSON.parse(
          readFileSync(join(this.eventsDirectory(workflowRunId), name), 'utf8')
        )
        if (
          parsed.schemaVersion !== EVENT_BATCH_SCHEMA_VERSION ||
          typeof parsed.expectedRevision !== 'string' ||
          !Array.isArray(parsed.events)
        ) {
          throw new Error('invalid event batch shape')
        }
        return {
          schemaVersion: EVENT_BATCH_SCHEMA_VERSION,
          expectedRevision: parsed.expectedRevision,
          events: parsed.events.map((event: unknown) => SchedulerEventSchema.parse(event))
        }
      } catch (error) {
        throw new AppendOnlyEventStoreError(
          'corrupt_event_batch',
          `cannot read ${name}: ${String(error)}`
        )
      }
    })
  }

  private listBatchNames(workflowRunId: string): string[] {
    try {
      return readdirSync(this.eventsDirectory(workflowRunId))
        .filter((name) => /^\d{10}\.json$/.test(name))
        .sort()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  private publishBatch(workflowRunId: string, index: number, batch: PersistedEventBatch): void {
    const finalPath = join(
      this.eventsDirectory(workflowRunId),
      `${String(index).padStart(10, '0')}.json`
    )
    mkdirSync(dirname(finalPath), { recursive: true, mode: 0o700 })
    const temporaryPath = `${finalPath}.${process.pid}.${randomUUID()}.tmp`
    const descriptor = openSync(temporaryPath, 'wx', 0o600)
    try {
      writeFileSync(descriptor, `${JSON.stringify(batch, null, 2)}\n`, 'utf8')
      fsyncSync(descriptor)
    } finally {
      closeSync(descriptor)
    }
    try {
      linkSync(temporaryPath, finalPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new AppendOnlyEventStoreError(
          'parent_revision_mismatch',
          'another writer published the next event batch'
        )
      }
      throw error
    } finally {
      rmSync(temporaryPath, { force: true })
    }
  }

  private writeSummary(workflowRunId: string, revision: string, eventCount: number): void {
    const path = join(this.rootDirectory, 'runs', workflowRunId, 'snapshots', 'summary.json')
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileSync(path, `${JSON.stringify({ revision, eventCount })}\n`, { mode: 0o600 })
  }

  private eventsDirectory(workflowRunId: string): string {
    return join(this.rootDirectory, 'runs', workflowRunId, 'events')
  }
}

export function hashEvents(events: readonly SchedulerEvent[]): string {
  if (events.length === 0) return EMPTY_SCHEDULER_REVISION
  return createHash('sha256').update(JSON.stringify(events)).digest('hex')
}
