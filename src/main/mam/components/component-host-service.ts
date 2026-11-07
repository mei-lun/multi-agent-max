import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import {
  COMPONENT_HOST_CHANNEL,
  componentHostRequestSchema
} from '../../../shared/mam/component-host-api'
import { componentIdSchema, type ComponentManifest } from '../../../shared/mam/components'
import type { BinaryAssetStore, CreativeJobManager, HandlerRegistry } from '../creative-runtime'
import type { ComponentRegistry } from './registry'
import { openComponentWindow } from './component-window'
import { AssetGrants } from './host-asset-grants'
import { randomUUID } from 'node:crypto'
import type { AssetRef } from '../../../shared/mam/creative-runtime'
import { decodeImage, importNativeAsset, exportNativeAsset } from './host-native-assets'

export type ComponentHostContext = { projectId: string; manifest: ComponentManifest }
export function authorizeComponentSender(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  window: BrowserWindow
) {
  if (
    window.isDestroyed() ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    !event.senderFrame?.url.startsWith('mam-component://package/')
  )
    throw new Error('Untrusted component sender')
}
export function createComponentHostService(options: {
  registry: ComponentRegistry
  jobs: CreativeJobManager
  assets: BinaryAssetStore
  handlers: HandlerRegistry
  projectId: string
  preloadPath: string
  authorizationDirectory: string
  protectedDirectories?: readonly string[]
  listModels?: () => unknown | Promise<unknown>
}) {
  const grants = new AssetGrants(options.authorizationDirectory)
  const pins = new Map<string, { release(): void }>()
  const subscriptions = new Map<string, () => void>()
  const settled = new Set(['succeeded', 'failed', 'cancelled'])
  const pin = async (id: string) => {
    if (pins.has(id)) return
    const job = options.jobs.get(id)
    if (settled.has(job.state)) return
    const lease = await options.registry.acquireVersion(
      componentIdSchema.parse(job.request.componentId),
      job.request.componentVersion
    )
    if (pins.has(id)) {
      lease.release()
      return
    }
    pins.set(id, lease)
    subscriptions.set(
      id,
      options.jobs.subscribe(id, 0, () => {
        if (settled.has(options.jobs.get(id).state)) {
          pins.get(id)?.release()
          pins.delete(id)
          subscriptions.get(id)?.()
          subscriptions.delete(id)
        }
      })
    )
  }
  const ready = (async () => {
    await grants.ready()
    for (const job of options.jobs.list())
      if (job.request.projectId === options.projectId) await pin(job.id)
  })()
  const windows = new Map<number, { window: BrowserWindow; context: ComponentHostContext }>()
  const previews = new Map<string, { sender: number; ref: AssetRef }>()
  ipcMain.handle(COMPONENT_HOST_CHANNEL, async (event, input: unknown) => {
    await ready
    const binding = windows.get(event.sender.id)
    if (!binding) throw new Error('Unknown component window')
    authorizeComponentSender(event, binding.window)
    const request = componentHostRequestSchema.parse(input),
      { manifest, projectId } = binding.context
    const owns = (id: string) => {
      const job = options.jobs.get(id)
      if (
        job.request.componentId !== manifest.id ||
        job.request.componentVersion !== manifest.version ||
        job.request.projectId !== projectId
      )
        throw new Error('Job outside component context')
      return job
    }
    if (request.action === 'context') return structuredClone(binding.context)
    if (request.action === 'listModels') return options.listModels?.() ?? []
    if (request.action === 'storeImage') {
      const bytes = Buffer.from(request.bytes)
      const mime = decodeImage(bytes)
      const ref = await options.assets.import(
        (async function* () {
          yield bytes
        })(),
        { filename: request.filename, mime }
      )
      await grants.grant(projectId, manifest.id, ref)
      return ref
    }
    if (request.action === 'previewAsset' || request.action === 'exportAsset') {
      const ref = request.ref
      const output = options.jobs
        .list()
        .some(
          (j) =>
            j.request.projectId === projectId &&
            j.request.componentId === manifest.id &&
            j.request.componentVersion === manifest.version &&
            j.events.some((e) => grants.contains(e.data, ref))
        )
      if (!(await grants.has(projectId, manifest.id, ref)) && !output)
        throw new Error('Asset outside component context')
      await options.assets.read(ref)
      if (request.action === 'exportAsset') {
        return exportNativeAsset(binding.window, options.assets, ref, options.protectedDirectories)
      }
      const token = randomUUID()
      previews.set(token, { sender: event.sender.id, ref })
      return `mam-component://package/__assets/${token}`
    }
    if (request.action === 'listJobs')
      return options.jobs
        .list()
        .filter(
          (j) =>
            j.request.componentId === manifest.id &&
            j.request.componentVersion === manifest.version &&
            j.request.projectId === projectId
        )
    if (request.action === 'events') {
      owns(request.jobId)
      return options.jobs.events(request.jobId, request.afterSequence)
    }
    if (request.action === 'cancel') {
      owns(request.jobId)
      return options.jobs.cancel(request.jobId)
    }
    if (request.action === 'deleteJob') {
      const job = owns(request.jobId)
      if (!settled.has(job.state)) throw new Error('Only terminal jobs can be deleted')
      const retain = async (value: unknown): Promise<void> => {
        const { assetRefSchema } = await import('../../../shared/mam/creative-runtime')
        const parsed = assetRefSchema.safeParse(value)
        if (parsed.success) {
          await grants.grant(projectId, manifest.id, parsed.data)
          return
        }
        if (value && typeof value === 'object')
          for (const child of Object.values(value)) await retain(child)
      }
      for (const event of job.events) await retain(event.data)
      await options.jobs.delete(job.id)
      return true
    }
    if (request.action === 'importAsset') {
      const ref = await importNativeAsset(binding.window, options.assets)
      if (!ref) return null
      await grants.grant(projectId, manifest.id, ref)
      return ref
    }
    if (!manifest.operations.some((o) => o.id === request.operation))
      throw new Error('Operation absent from component manifest')
    for (const ref of request.inputAssets) {
      const ownedOutput = options.jobs
        .list()
        .some(
          (j) =>
            j.request.projectId === projectId &&
            j.request.componentId === manifest.id &&
            j.events.some((e) => grants.contains(e.data, ref))
        )
      if (!(await grants.has(projectId, manifest.id, ref)) && !ownedOutput)
        throw new Error('Asset outside component context')
      await options.assets.read(ref)
    }
    const job = {
      ...request,
      componentId: manifest.id,
      componentVersion: manifest.version,
      projectId
    }
    const { action: _action, ...submission } = job
    if (!options.handlers(submission)) throw new Error('No host handler registered for operation')
    const lease = await options.registry.acquire(manifest.id)
    if (lease.manifest.version !== manifest.version) {
      lease.release()
      throw new Error('Component version changed')
    }
    try {
      const id = await options.jobs.submit(submission)
      await pin(id)
      lease.release()
      return id
    } catch (error) {
      lease.release()
      throw error
    }
  })
  return {
    ready: () => ready,
    open: (id: ComponentManifest['id']) => {
      let senderId: number | undefined
      return openComponentWindow(options.registry, id, {
        preloadPath: options.preloadPath,
        asset: async (request) => {
          const url = new URL(request.url)
          if (!url.pathname.startsWith('/__assets/')) return undefined
          const entry = previews.get(url.pathname.slice('/__assets/'.length))
          if (
            !entry ||
            entry.sender !== senderId ||
            !windows.has(entry.sender) ||
            request.method !== 'GET'
          )
            return new Response(null, { status: 404 })
          return new Response(new Uint8Array(await options.assets.read(entry.ref)), {
            headers: { 'Content-Type': entry.ref.mime, 'X-Content-Type-Options': 'nosniff' }
          })
        },
        bind: (window, manifest) => {
          senderId = window.webContents.id
          windows.set(window.webContents.id, {
            window,
            context: { manifest, projectId: options.projectId }
          })
          const key = window.webContents.id
          window.once('closed', () => {
            windows.delete(key)
            for (const [token, entry] of previews) if (entry.sender === key) previews.delete(token)
          })
        }
      })
    },
    dispose: () => {
      ipcMain.removeHandler(COMPONENT_HOST_CHANNEL)
      for (const { window } of windows.values()) if (!window.isDestroyed()) window.destroy()
      windows.clear()
    }
  }
}
