import { ipcMain, type BrowserWindow } from 'electron'
import { authorizeComponentSender } from './component-sender-authority'
export { authorizeComponentSender } from './component-sender-authority'
import {
  COMPONENT_HOST_CHANNEL,
  componentHostRequestSchema
} from '../../../shared/mam/component-host-api'
import { componentIdSchema, type ComponentManifest } from '../../../shared/mam/components'
import type { BinaryAssetStore, CreativeJobManager, HandlerRegistry } from '../creative-runtime'
import type { ComponentRegistry } from './registry'
import { openComponentWindow, componentPartition } from './component-window'
import { AssetGrants } from './host-asset-grants'
import { randomUUID } from 'node:crypto'
import type { AssetRef } from '../../../shared/mam/creative-runtime'
import { decodeImage, importNativeAsset, exportNativeAsset } from './host-native-assets'
import { bindComponentCloseLifecycle } from './component-close-lifecycle'
import { projectMedia } from './host-project-media'
import type { RifeSettings } from './host-rife-settings'
import { ConstellationToolSessions } from './host-constellation-tools'

export type ComponentHostContext = { projectId: string; manifest: ComponentManifest }
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
  rifeSettings?: RifeSettings
}) {
  const grants = new AssetGrants(options.authorizationDirectory)
  const tools = new ConstellationToolSessions(
    options.protectedDirectories?.[0] ?? options.authorizationDirectory,
    options.assets
  )
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
  const opening = new Map<string, Promise<void>>()
  const closers = new Map<number, ReturnType<typeof bindComponentCloseLifecycle>>()
  let disposed = false
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
    if (request.action === 'toolCheck')
      return tools.check(binding.window, manifest, projectId, request.call)
    if (request.action === 'toolExecute')
      return tools.execute(binding.window, manifest, projectId, request.token)
    if (request.action === 'listModels') return options.listModels?.() ?? []
    if (request.action === 'configureRife') {
      if (manifest.id !== 'creative.spine' || !options.rifeSettings)
        throw new Error('RIFE configuration unavailable')
      return options.rifeSettings.configure(binding.window)
    }
    if (request.action === 'listProjectMedia') {
      const result = projectMedia(
        options.jobs.list(),
        projectId,
        manifest,
        request.kind,
        request.limit
      )
      for (const item of result.assets) {
        await options.assets.read(item.ref)
        await grants.grant(projectId, manifest.id, item.ref)
      }
      return result
    }
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
      if (request.kind === 'file' && manifest.id !== 'creative.constellation')
        throw new Error('Generic file import unavailable')
      const ref = await importNativeAsset(binding.window, options.assets, request.kind)
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
    closeAll: async () => {
      await Promise.allSettled(opening.values())
      for (const closer of closers.values()) if (!(await closer.requestClose())) return false
      return true
    },
    ready: () => ready,
    open: (id: ComponentManifest['id']) => {
      if (disposed) return Promise.reject(new Error('Component host disposed'))
      const pending = opening.get(id)
      if (pending) return pending
      const existing = [...windows.values()].find(
        (binding) => binding.context.manifest.id === id && !binding.window.isDestroyed()
      )
      if (existing) {
        existing.window.show()
        existing.window.focus()
        return Promise.resolve()
      }
      let senderId: number | undefined
      const result = openComponentWindow(options.registry, id, {
        partitionKey: componentPartition(options.projectId, id),
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
          if (disposed) {
            window.destroy()
            throw new Error('Component host disposed')
          }
          senderId = window.webContents.id
          windows.set(window.webContents.id, {
            window,
            context: { manifest, projectId: options.projectId }
          })
          const key = window.webContents.id
          closers.set(key, bindComponentCloseLifecycle(window))
          window.once('closed', () => {
            windows.delete(key)
            closers.delete(key)
            for (const [token, entry] of previews) if (entry.sender === key) previews.delete(token)
          })
        }
      }).finally(() => opening.delete(id))
      opening.set(id, result)
      return result
    },
    dispose: () => {
      disposed = true
      ipcMain.removeHandler(COMPONENT_HOST_CHANNEL)
      for (const { window } of windows.values()) if (!window.isDestroyed()) window.destroy()
      windows.clear()
    }
  }
}
