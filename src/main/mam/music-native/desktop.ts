import { dialog } from 'electron'
import { join } from 'node:path'
import { platform, arch } from 'node:os'
import { z } from 'zod'
import type { BinaryAssetStore } from '../creative-runtime/assets'
import type { HandlerRegistry } from '../creative-runtime/jobs'
import type { ComponentRegistry } from '../components/registry'
import type { MusicEngine } from '../../../shared/mam/music-native'
import { createMusicNativeServices } from './index'
import { createMusicResourceManager } from './resources'
import { musicHistory } from './history'
import { musicHardware, musicMemory } from './hardware'
import { runMusicJob } from './job-handler'
import { statfs } from 'node:fs/promises'
import { musicResourceSpecs, manifestName } from './resources/specs'

const engines: MusicEngine[] = ['musicgen', 'acestep', 'yue2']
const resourceParams = z.object({ engine: z.enum(['musicgen', 'acestep', 'yue2']) }).strict()
export function createDesktopMusicServices(options: {
  root: string
  assets: BinaryAssetStore
  registry: Pick<ComponentRegistry, 'acquire'>
  resources?: ReturnType<typeof createMusicResourceManager>
  coreFactory?: typeof createMusicNativeServices
}) {
  const root = join(options.root, 'music')
  const resources = options.resources ?? createMusicResourceManager({ root })
  let core: ReturnType<typeof createMusicNativeServices> | undefined
  let initializing: Promise<void> | undefined
  let lease: Awaited<ReturnType<ComponentRegistry['acquire']>> | undefined
  let releases: (() => void)[] = [],
    active = 0,
    changing = false,
    disposed = false
  let installController: AbortController | undefined
  let operationState: Record<string, unknown> | null = null
  let cachedJobs: unknown[] = []
  let stopping: Promise<void> | undefined
  const statusShape = async (raw: Record<string, unknown> = {}) => {
    const states = await Promise.all(engines.map((engine) => resources.status(engine)))
    let diskFreeBytes: number | null = null
    try {
      const disk = await statfs(options.root)
      diskFreeBytes = disk.bavail * disk.bsize
    } catch {
      /* Root may not exist yet. */
    }
    const nativeEngines = raw.engines as Record<string, object> | undefined
    return {
      supported: platform() === 'win32' && arch() === 'x64',
      ready: false,
      runtimeReady: states.some((state) => state.installed),
      modelReady: states[0]!.installed,
      root,
      memory: musicMemory(),
      diskFreeBytes,
      resourceVersion: musicResourceSpecs.musicgen.resourceVersion,
      ...raw,
      jobs: Array.isArray(raw.jobs) ? raw.jobs : cachedJobs,
      operation: operationState,
      engines: Object.fromEntries(
        engines.map((engine, i) => [
          engine,
          {
            ready: false,
            runtimeReady: states[i]!.installed,
            modelReady: states[i]!.installed,
            root: states[i]!.directory,
            resourceVersion: musicResourceSpecs[engine].resourceVersion,
            manifestName: manifestName(musicResourceSpecs[engine]),
            ...nativeEngines?.[engine]
          }
        ])
      )
    }
  }
  const stop = () =>
    (stopping ??= (async () => {
      await initializing
      await core?.dispose()
      core = undefined
      for (const release of releases) release()
      releases = []
      lease?.release()
      lease = undefined
    })().finally(() => {
      stopping = undefined
    }))
  const initialize = () =>
    (initializing ??= (async () => {
      await stopping
      if (core) return
      const roots: Partial<Record<MusicEngine, string>> = {}
      for (const engine of engines) {
        const status = await resources.status(engine)
        if (status.installed) {
          releases.push(resources.pin(engine))
          roots[engine] = status.directory
        }
      }
      try {
        lease = await options.registry.acquire('creative.music')
        core = (options.coreFactory ?? createMusicNativeServices)({
          root,
          assets: options.assets,
          modulesPath: join(lease.packageDirectory, 'modules/music_workbench'),
          installedEngineRoots: roots
        })
      } catch (error) {
        for (const release of releases) release()
        releases = []
        lease?.release()
        lease = undefined
        throw error
      }
    })().finally(() => {
      initializing = undefined
    }))
  const handlers: HandlerRegistry = (job) => {
    if (!job.operation.startsWith('music.')) return
    const operation = job.operation.slice(6)
    if (
      ![
        'status',
        'hardware',
        'list',
        'generate',
        'reference',
        'trim',
        'archive',
        'favorite',
        'export',
        'cancel',
        'resources.manifest',
        'resources.install',
        'resources.offline',
        'resources.remove',
        'resources.cancel'
      ].includes(operation)
    )
      return
    const snapshot = structuredClone(job)
    return {
      validate() {
        if (operation === 'resources.cancel') z.object({}).strict().parse(snapshot.params)
        else if (operation.startsWith('resources.')) resourceParams.parse(snapshot.params)
        if (snapshot.inputAssets.length && operation !== 'reference')
          throw new Error('Unexpected music assets')
      },
      async run(_accepted, context) {
        if (disposed) throw new Error('Music service unavailable')
        if (operation === 'resources.cancel') {
          z.object({}).strict().parse(snapshot.params)
          installController?.abort()
          return true
        }
        if (changing) {
          if (operation === 'status') return statusShape()
          if (operation === 'list') return cachedJobs
          throw new Error('Music resource operation in progress')
        }
        if (operation.startsWith('resources.')) {
          const { engine } = resourceParams.parse(snapshot.params)
          if (operation === 'resources.manifest') return resources.manifest(engine, context.signal)
          if (active) throw new Error('Music jobs are active')
          changing = true
          installController = new AbortController()
          operationState = {
            status: 'running',
            phase: 'prepare',
            engine,
            kind: operation === 'resources.remove' ? 'remove' : 'install'
          }
          try {
            cachedJobs = await musicHistory(root)
            await stop()
            const control = {
              signal: AbortSignal.any([context.signal, installController.signal]),
              onProgress: (progress: { phase: string; bytes: number; total: number }) => {
                operationState = {
                  ...operationState,
                  phase: progress.phase,
                  downloadedBytes: progress.bytes,
                  totalBytes: progress.total
                }
                void context.emit('log', operationState).catch(() => {})
              }
            }
            if (operation === 'resources.remove') {
              await resources.remove(engine)
              return resources.status(engine)
            }
            if (operation === 'resources.offline') {
              const selection = await dialog.showOpenDialog({
                properties: ['openDirectory'],
                title: 'Import offline music resources'
              })
              if (selection.canceled || !selection.filePaths[0])
                throw new Error('Offline import cancelled')
              return await resources.offline(engine, selection.filePaths[0], control)
            }
            return await resources.install(engine, control)
          } catch (error) {
            operationState = {
              ...operationState,
              status:
                installController.signal.aborted || context.signal.aborted ? 'cancelled' : 'failed'
            }
            throw error
          } finally {
            if (operationState?.status === 'running')
              operationState = { ...operationState, status: 'completed' }
            changing = false
            installController = undefined
          }
        }
        active++
        try {
          if (operation === 'hardware') return musicHardware()
          const states = await Promise.all(engines.map((engine) => resources.status(engine)))
          if (operation === 'status' && !core && !initializing) {
            cachedJobs = await musicHistory(root)
            return statusShape({
              jobs: cachedJobs,
              historyAvailable: true,
              engines: Object.fromEntries(
                engines.map((engine, index) => [engine, { ready: states[index]!.installed }])
              )
            })
          }
          if (
            !states.some((state) => state.installed) &&
            ['status', 'list', 'export', 'favorite', 'archive'].includes(operation)
          ) {
            if (core) throw new Error('Resource state changed while music worker active')
            const change =
              operation === 'favorite' || operation === 'archive'
                ? {
                    id: String(snapshot.params.id),
                    field: (operation === 'favorite' ? 'favorite' : 'archived') as
                      | 'favorite'
                      | 'archived',
                    value: snapshot.params[
                      operation === 'favorite' ? 'favorite' : 'archived'
                    ] as boolean
                  }
                : undefined
            const jobs = await musicHistory(root, change)
            if (operation === 'export')
              return runMusicJob(
                { root, assets: options.assets, call: async () => jobs },
                'export',
                snapshot,
                context
              )
            if (change) return jobs.find((job) => job.id === change.id)
            if (operation === 'list') return jobs
            cachedJobs = jobs
            return statusShape({ jobs, historyAvailable: true })
          }
          await initialize()
          const handler = core!.handlers(snapshot)
          if (!handler) throw new Error('Unsupported native music operation')
          handler.validate(snapshot)
          const result = await handler.run(snapshot, context)
          if (operation === 'status') {
            const raw = result as Record<string, unknown>
            cachedJobs = Array.isArray(raw.jobs) ? raw.jobs : await musicHistory(root)
            return statusShape({ ...raw, jobs: cachedJobs, historyAvailable: true })
          }
          return result
        } finally {
          active--
          // Generation handlers await terminal native state, so zero active calls is an idle queue.
          // Stop synchronously before returning: registry disable/uninstall can immediately proceed.
          if (active === 0 && core && !changing) await stop()
        }
      }
    }
  }
  return {
    handlers,
    dispose: async () => {
      disposed = true
      installController?.abort()
      await stop()
    }
  }
}
