import { dialog } from 'electron'
import { join } from 'node:path'
import { mkdir, readFile, writeFile, rm, lstat } from 'node:fs/promises'
import { totalmem, freemem } from 'node:os'
import { z } from 'zod'
import type { BinaryAssetStore } from '../creative-runtime/assets'
import type { ComponentRegistry } from '../components/registry'
import type { HandlerRegistry } from '../creative-runtime/jobs'
import {
  model3dStart,
  model3dId,
  model3dResourceSpec as spec
} from '../../../shared/mam/model3d-native'
import { decodeImage } from '../components/host-native-assets'
import {
  scopeDirectory,
  importProject,
  listProjects,
  projectRecord,
  projectArtifact
} from './projects'
import { runModelLauncher, type ModelSpawn } from './launcher'
import { model3dResources, names } from './resources'
import { musicHardware } from '../music-native/hardware'
import { nativeRootCoordinator } from '../components/native-root-coordinator'
const resourcesParams = z
  .object({ components: z.array(z.enum(names)).min(1).max(4).optional() })
  .strict()
export function createModel3dServices(options: {
  root: string
  assets: BinaryAssetStore
  registry: Pick<ComponentRegistry, 'acquire' | 'acquireVersion'>
  fetch?: typeof fetch
  spawn?: ModelSpawn
  validateImage?: (bytes: Buffer) => string
  version?: string
  resourceFactory?: typeof model3dResources
}) {
  const root = join(options.root, 'model3d'),
    resources = (options.resourceFactory ?? model3dResources)(root, options.fetch),
    controllers = new Map<
      AbortController,
      { scope: string; done: Promise<void>; finish: () => void }
    >()
  const shared = nativeRootCoordinator(root)
  let disposed = false
  const handlers: HandlerRegistry = (request) => {
    if (!request.operation.startsWith('model3d.')) return
    const action = request.operation.slice(8),
      snapshot = structuredClone(request),
      data = scopeDirectory(root, snapshot)
    if (
      ![
        'status',
        'import',
        'reference',
        'start',
        'cancel',
        'artifact',
        'export',
        'resources.manifest',
        'resources.install',
        'resources.offline',
        'resources.remove'
      ].includes(action)
    )
      return
    if (action === 'start') model3dStart.parse(snapshot.params)
    if (action.startsWith('resources.')) resourcesParams.parse(snapshot.params)
    if (snapshot.inputAssets.length && !['import', 'reference'].includes(action))
      throw new Error('Unexpected 3D assets')
    return {
      validate() {},
      async run(_accepted, context) {
        if (disposed) throw new Error('3D service disposed')
        if (action === 'cancel') {
          for (const [controller, record] of controllers)
            if (record.scope === data) controller.abort()
          return true
        }
        if (action === 'status') {
          const operation = await readFile(join(data, 'operation.json'), 'utf8')
            .then(JSON.parse)
            .catch(() => null)
          const hardware = (await musicHardware()) as { gpus: unknown[]; error?: string }
          return {
            supported: process.platform === 'win32' && process.arch === 'x64',
            resourceVersion: spec.resourceVersion,
            system: {
              platform: spec.target,
              gpus: hardware.gpus,
              gpuDetectionAvailable: !hardware.error,
              ramTotalMiB: totalmem() / 1024 ** 2,
              ramAvailableMiB: freemem() / 1024 ** 2,
              diskFreeBytes: null
            },
            components: await resources.installed(),
            manifest: null,
            projects: await listProjects(data),
            operation,
            estimates: {
              shape: { vramMiB: 10500, ramMiB: 18000 },
              texture: { vramMiB: 6000, ramMiB: 14000 },
              rig: { vramMiB: 0, ramMiB: 4000 }
            }
          }
        }
        if (action === 'artifact' || action === 'export') {
          const assetRef = await projectArtifact(data, snapshot.params, options.assets)
          await context.emit('asset', assetRef)
          return { assetRef }
        }
        if (shared.busy) throw new Error('3D operation already running')
        shared.busy = true
        const controller = new AbortController()
        let finish = () => {}
        const done = new Promise<void>((resolve) => {
          finish = resolve
        })
        controllers.set(controller, { scope: data, done, finish })
        const signal = AbortSignal.any([controller.signal, context.signal])
        const tracked = action.startsWith('resources.') && action !== 'resources.manifest'
        let progress: Record<string, unknown> = {
          status: 'running',
          kind: action === 'resources.remove' ? 'remove' : 'install',
          phase: 'prepare',
          progress: 0,
          detail: '正在准备3D资源'
        }
        let writes = Promise.resolve()
        const report = (value: Record<string, unknown>) => {
          progress = { ...progress, ...value }
          const snapshot = JSON.stringify(progress)
          writes = writes.then(() => writeFile(join(data, 'operation.json'), snapshot))
          return writes
        }
        try {
          await mkdir(data, { recursive: true })
          if (tracked) await report({})
          if (action === 'import')
            return importProject(
              data,
              snapshot,
              options.assets,
              options.validateImage ?? decodeImage
            )
          if (action === 'reference') {
            if (snapshot.params.reset === true) {
              const id = model3dId.parse(snapshot.params.projectId),
                project = await projectRecord(data, id)
              delete project.reference
              await writeFile(join(data, 'projects', id, 'project.json'), JSON.stringify(project))
              return project
            }
            return importProject(
              data,
              snapshot,
              options.assets,
              options.validateImage ?? decodeImage,
              true
            )
          }
          if (action === 'resources.manifest') return resources.manifest(signal)
          if (action === 'resources.remove') {
            try {
              const stat = await lstat(resources.directory)
              if (stat.isSymbolicLink()) throw new Error('Unsafe resource directory')
              await rm(resources.directory, { recursive: true })
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
            }
            return true
          }
          if (action === 'resources.install' || action === 'resources.offline') {
            if (process.platform !== 'win32' || process.arch !== 'x64')
              throw new Error('Native 3D resource installation requires Windows x64')
            let offline: string | undefined
            if (action === 'resources.offline') {
              const chosen = await dialog.showOpenDialog({ properties: ['openDirectory'] })
              if (chosen.canceled || !chosen.filePaths[0])
                throw new Error('Offline import cancelled')
              offline = chosen.filePaths[0]
            }
            return await resources.install(
              resourcesParams.parse(snapshot.params).components ?? [...names],
              signal,
              async (value) => {
                await report(value as Record<string, unknown>)
                await context.emit('log', value)
              },
              offline
            )
          }
          const params = model3dStart.parse(snapshot.params)
          await projectRecord(data, params.projectId)
          const installed = await resources.installed(),
            needs =
              params.stage === 'shape'
                ? ['runtime', 'triposg']
                : params.stage === 'texture'
                  ? ['runtime', 'texture']
                  : ['blender', 'runtime']
          if (needs.some((name) => !installed[name]))
            throw new Error('Required 3D resources not installed')
          const lease = await options.registry.acquireVersion(
            'creative.model3d',
            snapshot.componentVersion
          )
          try {
            await context.emit('log', {
              type: 'model3d_started',
              projectId: params.projectId,
              stage: params.stage
            })
            await runModelLauncher({
              python: join(resources.directory, 'runtime/python/python.exe'),
              script: join(lease.packageDirectory, 'modules/model_workbench/launcher.py'),
              data,
              resources: resources.directory,
              version: options.version ?? '0.1.43',
              request: params,
              signal,
              ...(options.spawn ? { spawnProcess: options.spawn } : {}),
              emit: (value) => context.emit('log', value)
            })
            return projectRecord(data, params.projectId)
          } finally {
            lease.release()
          }
        } catch (error) {
          if (tracked)
            await report({
              status: signal.aborted ? 'cancelled' : 'failed',
              detail: signal.aborted ? '资源操作已取消' : '资源操作失败'
            })
          throw error
        } finally {
          if (tracked && progress.status === 'running')
            await report({
              status: 'completed',
              phase: 'installed',
              progress: 1,
              detail: '资源操作完成'
            })
          await writes
          controllers.get(controller)?.finish()
          controllers.delete(controller)
          shared.busy = false
        }
      }
    }
  }
  return {
    handlers,
    dispose: async () => {
      disposed = true
      for (const controller of controllers.keys()) controller.abort()
      await Promise.all([...controllers.values()].map((record) => record.done))
    }
  }
}
