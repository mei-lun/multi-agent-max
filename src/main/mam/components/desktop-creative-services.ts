import { app } from 'electron'
import { join, resolve } from 'node:path'
import { acquireServiceRootLock } from './service-root-lock'
import { BinaryAssetStore, CreativeJobManager, type HandlerRegistry } from '../creative-runtime'
import { ComponentRegistry } from './registry'
import { createComponentHostService } from './component-host-service'

export type DesktopCreativeServices = Awaited<ReturnType<typeof createServices>>
let current: Promise<DesktopCreativeServices> | undefined
let currentRoot: string | undefined

export function desktopCreativeServices(root: string): Promise<DesktopCreativeServices> {
  const normalized = resolve(root)
  if (currentRoot && currentRoot !== normalized)
    return Promise.reject(new Error('Creative services already bound to another root'))
  if (!current) {
    currentRoot = normalized
    current = createServices(normalized).catch((error: unknown) => {
      current = undefined
      currentRoot = undefined
      throw error
    })
  }
  return current
}

async function createServices(root: string) {
  const lock = await acquireServiceRootLock(root)
  let cleanup: (() => Promise<void>) | undefined
  try {
    const registry = new ComponentRegistry({
      root: join(root, 'components'),
      hostVersion: app.getVersion(),
      hostApiVersion: '1.0.0'
    })
    await registry.list()
    const assets = await BinaryAssetStore.open(join(root, 'creative-assets'))
    // Backend capabilities are registered explicitly as they are ported. A package
    // manifest never authorizes executing arbitrary native code in the main process.
    const handlers: HandlerRegistry = () => undefined
    const jobs = await CreativeJobManager.open({
      directory: join(root, 'creative-jobs'),
      handlers,
      validateInputs: async (request) => {
        for (const ref of request.inputAssets) await assets.read(ref)
      }
    })
    cleanup = () => jobs.dispose()
    const host = createComponentHostService({
      registry,
      assets,
      jobs,
      handlers,
      projectId: 'creative.local',
      authorizationDirectory: join(root, 'creative-authorization'),
      preloadPath: join(__dirname, '../preload/component-api.cjs')
    })
    cleanup = async () => {
      host.dispose()
      await jobs.dispose()
    }
    await host.ready()
    let closing = false
    app.on('before-quit', (event) => {
      if (closing) return
      closing = true
      event.preventDefault()
      host.dispose()
      void jobs
        .dispose()
        .finally(() => lock.release())
        .finally(() => app.quit())
    })
    return { registry, assets, jobs, host }
  } catch (error) {
    try {
      await cleanup?.()
    } finally {
      await lock.release()
    }
    throw error
  }
}
