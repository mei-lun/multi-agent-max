import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EMPTY_SCHEDULER_REVISION } from '../../../shared/mam/scheduler-protocol'
import { SchedulerKernel, type KernelEventBatch } from '../scheduler/kernel'
import { AppendOnlyEventStore } from './append-only-event-store'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('AppendOnlyEventStore', () => {
  it('accepts only Kernel-authorized batches', async () => {
    const store = new AppendOnlyEventStore(await createRoot())
    expect(() =>
      store.append('run.1', { events: [] } as unknown as KernelEventBatch, EMPTY_SCHEDULER_REVISION)
    ).toThrow(expect.objectContaining({ code: 'scheduler_authority_required' }))
  })

  it('publishes each command as one atomic batch file', async () => {
    const root = await createRoot()
    const store = new AppendOnlyEventStore(root)
    const batch = createRunBatch()
    const result = store.append('run.1', batch, EMPTY_SCHEDULER_REVISION)
    expect(result.appendedEventIds).toEqual(['command.create:event:1'])
    expect(store.listEvents('run.1')).toHaveLength(1)
    expect(await readdir(join(root, 'runs', 'run.1', 'events'))).toEqual(['0000000001.json'])
  })

  it('rejects a stale writer without overwriting the winning batch', async () => {
    const root = await createRoot()
    const first = new AppendOnlyEventStore(root)
    const second = new AppendOnlyEventStore(root)
    first.append('run.1', createRunBatch(), EMPTY_SCHEDULER_REVISION)
    expect(() =>
      second.append('run.1', createRunBatch('command.other'), EMPTY_SCHEDULER_REVISION)
    ).toThrow(expect.objectContaining({ code: 'parent_revision_mismatch' }))
    expect(first.listEvents('run.1').map((event) => event.commandId)).toEqual(['command.create'])
  })

  it('rejects run IDs that could escape the state directory', async () => {
    const store = new AppendOnlyEventStore(await createRoot())
    expect(() => store.listEvents('../outside')).toThrow()
  })
})

function createRunBatch(commandId = 'command.create'): KernelEventBatch {
  return new SchedulerKernel().execute(
    {
      schemaVersion: '1.0.0',
      commandId,
      issuedAt: '2026-07-27T10:00:00Z',
      workflowRunId: 'run.1',
      actor: { kind: 'scheduler', schedulerId: 'scheduler.1' },
      type: 'create_workflow_run',
      definitionId: 'workflow.1',
      definitionVersion: 1,
      planHash: 'a'.repeat(64),
      roleCatalogHash: 'b'.repeat(64)
    },
    {
      schedulerId: 'scheduler.1',
      validArtifactHashes: new Set(),
      processedCommandIds: new Set(),
      mergeQueueEntries: new Map()
    }
  )
}

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mam-state-'))
  temporaryDirectories.push(root)
  return root
}
