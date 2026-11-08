import { dispatchComponentRequest } from './component-host-dispatch'
import type { ComponentHostContext, ComponentHostOptions } from './component-host-context'
export type { ComponentHostContext } from './component-host-context'
import { ipcMain, type BrowserWindow } from 'electron'
import { authorizeComponentSender } from './component-sender-authority'
export { authorizeComponentSender } from './component-sender-authority'
import {
  COMPONENT_HOST_CHANNEL,
  componentHostRequestSchema
} from '../../../shared/mam/component-host-api'
import { componentIdSchema, type ComponentManifest } from '../../../shared/mam/components'
import { openComponentWindow, componentPartition } from './component-window'
import { AssetGrants } from './host-asset-grants'
import type { AssetRef } from '../../../shared/mam/creative-runtime'
import { bindComponentCloseLifecycle } from './component-close-lifecycle'
import { ConstellationToolSessions } from './host-constellation-tools'
import { createBackgroundCapabilities } from './host-background-capabilities'

export function createComponentHostService(options: ComponentHostOptions) {
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
    const installed = await options.registry.list()
    for (const job of options.jobs.list()) {
      if (
        installed.some(
          (item) =>
            item.id === job.request.componentId &&
            item.versions.some(
              (version) =>
                version.manifest.version === job.request.componentVersion &&
                version.status === 'installed'
            )
        )
      )
        await pin(job.id)
    }
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
    const request = componentHostRequestSchema.parse(input)
    return dispatchComponentRequest(
      { options, grants, tools, previews, pin, open: host.open },
      binding,
      event.sender.id,
      request
    )
  })
  const host = {
    invokeCapability: createBackgroundCapabilities({
      options,
      grants,
      tools,
      previews,
      pin,
      open: (id, projectId): Promise<void> => host.open(id, projectId)
    }),
    closeAll: async () => {
      await Promise.allSettled(opening.values())
      for (const closer of closers.values()) if (!(await closer.requestClose())) return false
      return true
    },
    ready: () => ready,
    open: (id: ComponentManifest['id'], projectId = options.projectId): Promise<void> => {
      const windowKey = JSON.stringify([projectId, id])
      if (disposed) return Promise.reject(new Error('Component host disposed'))
      const pending = opening.get(windowKey)
      if (pending) return pending
      const existing = [...windows.values()].find(
        (binding) =>
          binding.context.manifest.id === id &&
          binding.context.projectId === projectId &&
          !binding.window.isDestroyed()
      )
      if (existing) {
        existing.window.show()
        existing.window.focus()
        return Promise.resolve()
      }
      let senderId: number | undefined
      const result = openComponentWindow(options.registry, id, {
        partitionKey: componentPartition(projectId, id),
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
            context: { manifest, projectId }
          })
          const key = window.webContents.id
          closers.set(key, bindComponentCloseLifecycle(window))
          window.once('closed', () => {
            windows.delete(key)
            closers.delete(key)
            for (const [token, entry] of previews) if (entry.sender === key) previews.delete(token)
          })
        }
      }).finally(() => opening.delete(windowKey))
      opening.set(windowKey, result)
      return result
    },
    dispose: () => {
      disposed = true
      ipcMain.removeHandler(COMPONENT_HOST_CHANNEL)
      for (const { window } of windows.values()) if (!window.isDestroyed()) window.destroy()
      windows.clear()
    }
  }
  return host
}
