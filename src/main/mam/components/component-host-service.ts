import { createReadStream } from 'node:fs'
import { lstat } from 'node:fs/promises'
import { basename } from 'node:path'
import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import {
  COMPONENT_HOST_CHANNEL,
  componentHostRequestSchema
} from '../../../shared/mam/component-host-api'
import { componentIdSchema, type ComponentManifest } from '../../../shared/mam/components'
import type { BinaryAssetStore, CreativeJobManager, HandlerRegistry } from '../creative-runtime'
import type { ComponentRegistry } from './registry'
import { openComponentWindow } from './component-window'
import { AssetGrants } from './host-asset-grants'

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
    if (request.action === 'importAsset') {
      const selected = await dialog.showOpenDialog(binding.window, { properties: ['openFile'] })
      const file = selected.filePaths[0]
      if (selected.canceled || !file) return null
      const stat = await lstat(file)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe import source')
      const ref = await options.assets.import(createReadStream(file), {
        filename: basename(file),
        mime: 'application/octet-stream'
      })
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
    open: (id: ComponentManifest['id']) =>
      openComponentWindow(options.registry, id, {
        preloadPath: options.preloadPath,
        bind: (window, manifest) => {
          windows.set(window.webContents.id, {
            window,
            context: { manifest, projectId: options.projectId }
          })
          const key = window.webContents.id
          window.once('closed', () => windows.delete(key))
        }
      }),
    dispose: () => {
      ipcMain.removeHandler(COMPONENT_HOST_CHANNEL)
      for (const { window } of windows.values()) if (!window.isDestroyed()) window.destroy()
      windows.clear()
    }
  }
}
