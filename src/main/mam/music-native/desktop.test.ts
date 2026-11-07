import { expect, test, vi } from 'vitest'
vi.mock('electron', () => ({ dialog: { showOpenDialog: vi.fn() } }))
import { createDesktopMusicServices } from './desktop'
import { createMusicResourceManager } from './resources'
import type { ComponentRegistry } from '../components/registry'
import type { BinaryAssetStore } from '../creative-runtime/assets'

test('desktop unavailable status preserves explicit missing-history warning and releases package', async () => {
  const release = vi.fn()
  const registry = {
    acquire: vi.fn(async () => ({ packageDirectory: '.', release }))
  } as unknown as ComponentRegistry
  const resources = createMusicResourceManager({ root: 'unused-test-music-root' })
  vi.spyOn(resources, 'status').mockResolvedValue({
    installed: false,
    directory: '.',
    pinned: false
  })
  const service = createDesktopMusicServices({
    root: 'unused-test-music-root',
    registry,
    resources,
    assets: {} as BinaryAssetStore
  })
  const job = {
    componentId: 'creative.music',
    componentVersion: '1',
    projectId: 'p',
    operation: 'music.status',
    idempotencyKey: 'k',
    params: {},
    inputAssets: []
  }
  const handler = service.handlers(job)!
  const result = await handler.run(job, {
    signal: new AbortController().signal,
    emit: async () => {}
  })
  expect(result).toMatchObject({ ready: false, historyAvailable: true, jobs: [] })
  await service.dispose()
  expect(release).not.toHaveBeenCalled()
})

test('renderer cannot supply an offline directory', () => {
  const service = createDesktopMusicServices({
    root: '.',
    registry: {} as ComponentRegistry,
    assets: {} as BinaryAssetStore
  })
  const job = {
    componentId: 'creative.music',
    componentVersion: '1',
    projectId: 'p',
    operation: 'music.resources.offline',
    idempotencyKey: 'k',
    params: { engine: 'musicgen', path: 'arbitrary' },
    inputAssets: []
  }
  expect(() => service.handlers(job)!.validate(job)).toThrow()
})
test('installed idle status does not acquire a package or start Python', async () => {
  const resources = createMusicResourceManager({ root: 'unused-test-music-root' })
  vi.spyOn(resources, 'status').mockResolvedValue({
    installed: true,
    directory: '.',
    pinned: false
  })
  const acquire = vi.fn(),
    coreFactory = vi.fn()
  const service = createDesktopMusicServices({
    root: 'unused-test-music-root',
    registry: { acquire } as unknown as ComponentRegistry,
    resources,
    assets: {} as BinaryAssetStore,
    coreFactory
  })
  const job = {
    componentId: 'creative.music',
    componentVersion: '1',
    projectId: 'p',
    operation: 'music.status',
    idempotencyKey: 'k',
    params: {},
    inputAssets: []
  }
  const result = await service
    .handlers(job)!
    .run(job, { signal: new AbortController().signal, emit: async () => {} })
  expect(result).toMatchObject({ engines: { musicgen: { ready: true } }, historyAvailable: true })
  expect(acquire).not.toHaveBeenCalled()
  expect(coreFactory).not.toHaveBeenCalled()
  await service.dispose()
})
test('completed native operation drains core and releases component lease before returning', async () => {
  const resources = createMusicResourceManager({ root: 'unused-test-music-root' })
  vi.spyOn(resources, 'status').mockResolvedValue({
    installed: true,
    directory: '.',
    pinned: false
  })
  const release = vi.fn(),
    dispose = vi.fn(async () => {}),
    acquire = vi.fn(async () => ({ packageDirectory: '.', release }))
  const coreFactory = vi.fn(() => ({
    handlers: () => ({ validate() {}, run: async () => [] }),
    dispose,
    request: async () => []
  }))
  const service = createDesktopMusicServices({
    root: 'unused-test-music-root',
    registry: { acquire } as unknown as ComponentRegistry,
    resources,
    assets: {} as BinaryAssetStore,
    coreFactory
  })
  const job = {
    componentId: 'creative.music',
    componentVersion: '1',
    projectId: 'p',
    operation: 'music.list',
    idempotencyKey: 'k',
    params: {},
    inputAssets: []
  }
  await service
    .handlers(job)!
    .run(job, { signal: new AbortController().signal, emit: async () => {} })
  expect(dispose).toHaveBeenCalledOnce()
  expect(release).toHaveBeenCalledOnce()
  expect((await resources.status('musicgen')).pinned).toBe(false)
  await service.dispose()
})

test('status remains complete and install progress can be polled and cancelled', async () => {
  const resources = createMusicResourceManager({ root: 'unused-test-music-root' })
  vi.spyOn(resources, 'status').mockResolvedValue({
    installed: false,
    directory: '.',
    pinned: false
  })
  let entered!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  vi.spyOn(resources, 'install').mockImplementation(async (_engine, control) => {
    control!.onProgress!({ phase: 'download', bytes: 5, total: 10 })
    entered()
    await new Promise<void>((_resolve, reject) =>
      control!.signal!.addEventListener('abort', () => reject(new Error('cancelled')), {
        once: true
      })
    )
    throw new Error('unreachable')
  })
  const service = createDesktopMusicServices({
    root: 'unused-test-music-root',
    registry: {} as ComponentRegistry,
    resources,
    assets: {} as BinaryAssetStore
  })
  const context = { signal: new AbortController().signal, emit: async () => {} }
  const run = (operation: string, params = {}) => {
    const job = {
      componentId: 'creative.music',
      componentVersion: '1',
      projectId: 'p',
      operation: `music.${operation}`,
      idempotencyKey: operation,
      params,
      inputAssets: []
    }
    return service.handlers(job)!.run(job, context)
  }
  const install = run('resources.install', { engine: 'musicgen' })
  const rejection = expect(install).rejects.toThrow('cancelled')
  await started
  expect(await run('status')).toMatchObject({
    memory: { availableMiB: expect.any(Number) },
    root: expect.any(String),
    resourceVersion: expect.any(String),
    operation: { status: 'running', downloadedBytes: 5, totalBytes: 10 }
  })
  await run('resources.cancel')
  await rejection
  expect(await run('status')).toMatchObject({ operation: { status: 'cancelled' } })
  await service.dispose()
})
