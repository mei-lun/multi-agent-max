import { app, dialog } from 'electron'
import { installComponentQuitGuard } from './component-app-quit'
import { join, resolve } from 'node:path'
import { acquireServiceRootLock } from './service-root-lock'
import { BinaryAssetStore, CreativeJobManager, type HandlerRegistry } from '../creative-runtime'
import { ComponentRegistry } from './registry'
import { createComponentHostService } from './component-host-service'
import type { CreativeJob } from '../../../shared/mam/creative-runtime'
import { RifeSettings } from './host-rife-settings'

export type DesktopCreativeServices = Awaited<ReturnType<typeof createServices>>
let current: Promise<DesktopCreativeServices> | undefined
let currentRoot: string | undefined

export type CreativeMediaFactory = (
  assets: BinaryAssetStore,
  lookupJob: (id: string) => CreativeJob | undefined,
  host: { root: string; registry: ComponentRegistry; rifeSettings: RifeSettings }
) => {
  handlers: HandlerRegistry
  listModels: () => unknown | Promise<unknown>
  dispose?: () => Promise<void>
}
export function desktopCreativeServices(
  root: string,
  factory: CreativeMediaFactory
): Promise<DesktopCreativeServices> {
  const normalized = resolve(root)
  if (currentRoot && currentRoot !== normalized)
    return Promise.reject(new Error('Creative services already bound to another root'))
  if (!current) {
    currentRoot = normalized
    current = createServices(normalized, factory).catch((error: unknown) => {
      current = undefined
      currentRoot = undefined
      throw error
    })
  }
  return current
}

async function createServices(root: string, factory: CreativeMediaFactory) {
  const lock = await acquireServiceRootLock(root)
  let cleanup: (() => Promise<void>) | undefined
  try {
    const registry = new ComponentRegistry({
      root: join(root, 'components'),
      hostVersion: app.getVersion(),
      hostApiVersion: '1.0.0',
      capabilities: ['assets.projectMedia', 'tools.manual']
    })
    await registry.list()
    const assets = await BinaryAssetStore.open(join(root, 'creative-assets'))
    // Backend capabilities are registered explicitly as they are ported. A package
    // manifest never authorizes executing arbitrary native code in the main process.
    let activeJobs: CreativeJobManager | undefined
    const rifeSettings = new RifeSettings(join(root, 'native-settings'))
    const { handlers, listModels, dispose } = factory(
      assets,
      (id) => {
        if (!activeJobs) return undefined
        try {
          return activeJobs.get(id)
        } catch {
          return undefined
        }
      },
      { root, registry, rifeSettings }
    )
    const jobs = await CreativeJobManager.open({
      directory: join(root, 'creative-jobs'),
      handlers,
      validateInputs: async (request) => {
        for (const ref of request.inputAssets) await assets.read(ref)
      }
    })
    activeJobs = jobs
    cleanup = async () => {
      await jobs.dispose()
      await dispose?.()
    }
    const host = createComponentHostService({
      protectedDirectories: [root],
      registry,
      assets,
      jobs,
      handlers,
      projectId: 'creative.local',
      listModels,
      rifeSettings,
      authorizationDirectory: join(root, 'creative-authorization'),
      preloadPath: join(__dirname, '../preload/component-api.cjs')
    })
    cleanup = async () => {
      host.dispose()
      await jobs.dispose()
      await dispose?.()
    }
    await host.ready()
    installComponentQuitGuard({
      app,
      closeAll: () => host.closeAll(),
      cleanup: async () => {
        host.dispose()
        await jobs.dispose()
        await dispose?.()
      },
      release: () => lock.release(),
      report: () => {
        void dialog.showMessageBox({
          type: 'error',
          title: 'Unable to quit',
          message:
            'Component saving or shutdown failed. The application remains open; save your work and try again.'
        })
      }
    })
    return { registry, assets, jobs, host, handlers }
  } catch (error) {
    try {
      await cleanup?.()
    } finally {
      await lock.release()
    }
    throw error
  }
}
