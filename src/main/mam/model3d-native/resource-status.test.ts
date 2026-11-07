import { test, expect, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ComponentRegistry } from '../components/registry'
import type { BinaryAssetStore } from '../creative-runtime/assets'
vi.mock('electron', () => ({ dialog: {}, nativeImage: {} }))
vi.mock('../music-native/hardware', () => ({ musicHardware: async () => ({ gpus: [] }) }))
import { createModel3dServices } from './index'
test('delayed resource install exposes durable running progress and scoped cancel', async () => {
  if (process.platform !== 'win32') return
  const root = await mkdtemp(join(tmpdir(), 'model-status-'))
  let started!: () => void
  const entered = new Promise<void>((resolve) => {
    started = resolve
  })
  const service = createModel3dServices({
    root,
    assets: {} as BinaryAssetStore,
    registry: {} as ComponentRegistry,
    resourceFactory: () => ({
      directory: join(root, 'resource'),
      manifest: async () => {
        throw Error('not used')
      },
      installed: async () => ({ runtime: false }),
      install: async (_selected, signal, emit) => {
        await emit({ phase: 'download', downloadedBytes: 5, totalBytes: 10 })
        started()
        await new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(Error('cancelled')), { once: true })
        )
        return { runtime: false }
      }
    })
  })
  const run = (operation: string) => {
    const job = {
      componentId: 'creative.model3d',
      componentVersion: '1',
      projectId: 'p',
      operation: 'model3d.' + operation,
      idempotencyKey: operation,
      params: {},
      inputAssets: []
    }
    return service
      .handlers(job)!
      .run(job, { signal: new AbortController().signal, emit: async () => {} })
  }
  try {
    const install = run('resources.install'),
      rejection = expect(install).rejects.toThrow('cancelled')
    await entered
    expect(await run('status')).toMatchObject({
      operation: { status: 'running', downloadedBytes: 5, totalBytes: 10 }
    })
    await run('cancel')
    await rejection
    expect(await run('status')).toMatchObject({ operation: { status: 'cancelled' } })
  } finally {
    await service.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
