import { expect, test, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
type Host = {
  bind: (window: BrowserWindow, manifest: unknown) => void
  asset: (request: Request) => Promise<Response>
}
type Sender = { host: Host; event: IpcMainInvokeEvent }
const fake = vi.hoisted(() => ({
  invoke: undefined as unknown as (event: IpcMainInvokeEvent, request: unknown) => Promise<never>,
  hosts: [] as Sender[]
}))
vi.mock('electron', () => ({
  nativeImage: {
    createFromBuffer: () => ({ isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }) })
  },
  ipcMain: {
    handle: (_: string, fn: typeof fake.invoke) => {
      fake.invoke = fn
    },
    removeHandler() {}
  },
  dialog: { showSaveDialog: async () => ({ canceled: true }) }
}))
vi.mock('./component-window', () => ({
  openComponentWindow: async (_: unknown, id: string, host: Host) => {
    const mainFrame = { url: 'mam-component://package/index.html' }
    const window = {
      webContents: { id: fake.hosts.length + 1, mainFrame },
      isDestroyed: () => false,
      once() {},
      destroy() {}
    }
    host.bind(window as unknown as BrowserWindow, {
      id,
      version: '1.0.0',
      operations: [{ id: 'render' }]
    })
    fake.hosts.push({
      host,
      event: { sender: window.webContents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent
    })
  }
}))
import { createComponentHostService } from './component-host-service'
import { BinaryAssetStore, CreativeJobManager } from '../creative-runtime'
import type { ComponentRegistry } from './registry'
test('real assets and jobs remain scoped behind the fake Electron bridge', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'host-media-'))
  const assets = await BinaryAssetStore.open(join(directory, 'assets'))
  const handlers = () => ({ validate() {}, run: async () => ({ value: 1 }) })
  const jobs = await CreativeJobManager.open({ directory: join(directory, 'jobs'), handlers })
  const registry = {
    acquire: async () => ({ manifest: { version: '1.0.0' }, release() {} }),
    acquireVersion: async () => ({ release() {} })
  } as unknown as ComponentRegistry
  const service = createComponentHostService({
    assets,
    jobs,
    handlers,
    registry,
    projectId: 'p',
    preloadPath: '',
    authorizationDirectory: join(directory, 'grants'),
    listModels: () => [{ id: 'safe' }]
  })
  try {
    await service.open('creative.image')
    await service.open('creative.video')
    const a = fake.hosts[0]!,
      b = fake.hosts[1]!
    const invoke = (request: unknown, sender = a) => fake.invoke(sender.event, request)
    expect(await invoke({ action: 'listModels' })).toEqual([{ id: 'safe' }])
    const bytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=',
      'base64'
    )
    const ref = await invoke({ action: 'storeImage', bytes: [...bytes], filename: 'mask.png' })
    const url = await invoke({ action: 'previewAsset', ref })
    expect((await a.host.asset(new Request(url))).status).toBe(200)
    expect((await b.host.asset(new Request(url))).status).toBe(404)
    await expect(invoke({ action: 'previewAsset', ref }, b)).rejects.toThrow('outside')
    await expect(invoke({ action: 'exportAsset', ref }, b)).rejects.toThrow('outside')
    expect(await invoke({ action: 'exportAsset', ref })).toBeNull()
    const submit = {
      action: 'submit',
      operation: 'render',
      idempotencyKey: 'one',
      params: {},
      inputAssets: [ref]
    }
    await expect(invoke(submit, b)).rejects.toThrow('outside')
    const id = await invoke(submit)
    expect(await invoke(submit)).toBe(id)
    await expect(invoke({ ...submit, projectId: 'victim' })).rejects.toThrow()
    await expect(invoke({ action: 'events', jobId: id, afterSequence: 0 }, b)).rejects.toThrow(
      'outside'
    )
  } finally {
    service.dispose()
    await jobs.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})
