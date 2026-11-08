import { join } from 'node:path'
import { createMediaServices, type MediaCatalog } from '../../src/main/mam/media'
import { createCreativeTextServices } from '../../src/main/mam/creative-text'
import { createSpineNativeServices } from '../../src/main/mam/spine-native'
import { createDesktopMusicServices } from '../../src/main/mam/music-native/desktop'
import { createModel3dServices } from '../../src/main/mam/model3d-native'
import { assets, invocation, rpc } from './capabilities'
import { decodeImage } from './image-inspection'
import { createWritingBusinessServices } from '../creative-writing/runtime-business'
import { createConstellationBusinessServices } from '../creative-constellation/runtime-business'
import { createSpineBusiness, spineBusinessOperations } from '../creative-spine/runtime-business'
import type { CreativeRequest } from '../../src/shared/mam/creative-runtime'
import type { ModelProfile, ProviderProfile } from '../../src/shared/mam/domain/execution-profile'
import type { ComponentRegistry } from '../../src/main/mam/components/registry'
import type { VideoReceipt } from '../../src/main/mam/media/video'
import type { RifeConfig } from '../../src/main/mam/spine-native/rife'

type Input = {
  request: CreativeRequest
  root: string
  resourceRoot?: string
  packageDirectory: string
  models: ModelProfile[]
  providers: ProviderProfile[]
  secret?: string
  secrets?: Record<string, string | undefined>
  receipt?: VideoReceipt
  rife?: RifeConfig
  listModels?: boolean
}
const controllers = new Map<string, AbortController>()
const executions = new Set<Promise<void>>()
let stopping = false
// Original editors use optional undefined fields; persisted Job payloads are JSON.
const jsonValue = (value: unknown): unknown =>
  value === undefined ? null : JSON.parse(JSON.stringify(value))
let native:
  | {
      music: ReturnType<typeof createDesktopMusicServices>
      model3d: ReturnType<typeof createModel3dServices>
    }
  | undefined
async function execute(input: Input, signal: AbortSignal) {
  const { request } = input
  const catalog: MediaCatalog = {
    models: {
      listActive: () => input.models,
      getActive: (id) => input.models.find((m) => m.id === id)
    },
    providers: { getActive: (id) => input.providers.find((p) => p.id === id) }
  }
  const dependencies = {
    catalog,
    resolveSecret: (ref: string) => input.secrets?.[ref] ?? input.secret,
    assets,
    validateImage: decodeImage
  }
  const media = createMediaServices({ ...dependencies, resolveVideoReceipt: () => input.receipt })
  const text = createCreativeTextServices(dependencies)
  if (input.listModels) return [...media.listModels(), ...text.listModels()]
  const acquire = async () => ({ packageDirectory: input.packageDirectory, release() {} })
  native ??= {
    music: createDesktopMusicServices({
      root: input.root,
      resourceRoot: input.resourceRoot ?? input.root,
      assets,
      registry: { acquire } as unknown as ComponentRegistry
    }),
    model3d: createModel3dServices({
      root: input.root,
      resourceRoot: input.resourceRoot ?? input.root,
      assets,
      registry: { acquire, acquireVersion: acquire } as unknown as ComponentRegistry,
      validateImage: decodeImage,
      version: request.componentVersion
    })
  }
  const spine = createSpineNativeServices({
    assets,
    validateImage: decodeImage,
    receiptDirectory: join(input.root, 'spine-receipts'),
    rife: input.rife
  })
  const writing = createWritingBusinessServices({
    generation: text.handlers,
    assets,
    hostCall: (method, value) => rpc(method, value)
  })
  if (spineBusinessOperations.includes(request.operation)) {
    const business = createSpineBusiness((value) => rpc('spine.render', value))
    const result = await business(request.operation, request.params)
    if (
      request.operation === 'spine.export' &&
      result &&
      typeof result === 'object' &&
      'base64' in result
    ) {
      const ref = await assets.import(
        (async function* () {
          yield Buffer.from(String(result.base64), 'base64')
        })(),
        { filename: 'spine-export.zip', mime: 'application/zip' }
      )
      await rpc('event', { type: 'asset', data: ref })
      return { assets: [ref] }
    }
    return result
  }
  const constellation = createConstellationBusinessServices({
    generation: (request) => media.handlers(request) ?? text.handlers(request),
    listModels: () => [...media.listModels(), ...text.listModels()],
    assets,
    hostCall: (method, value) => rpc(method, value)
  })
  const handler =
    constellation.handlers(request) ??
    writing.handlers(request) ??
    media.handlers(request) ??
    text.handlers(request) ??
    spine.handlers(request) ??
    native.music.handlers(request) ??
    native.model3d.handlers(request)
  if (!handler) throw new Error('Package operation unavailable')
  handler.validate(request)
  return handler.run(request, {
    signal,
    emit: async (type, data) => {
      await rpc('event', { type, data: jsonValue(data) })
    }
  })
}
process.on('message', (message: { type: string; id: string; value: Input }) => {
  if (message.type === 'cancel') {
    controllers.get(message.id)?.abort()
    return
  }
  if (message.type === 'dispose') {
    stopping = true
    for (const controller of controllers.values()) controller.abort()
    void Promise.allSettled([...executions])
      .then(() => Promise.all([native?.music.dispose(), native?.model3d.dispose()]))
      .then(
        () => process.exit(0),
        () => process.exit(1)
      )
    return
  }
  if (message.type !== 'run' || stopping) return
  const controller = new AbortController()
  controllers.set(message.id, controller)
  const execution = invocation.run(message.id, async () => {
    try {
      process.send!({
        type: 'result',
        id: message.id,
        value: jsonValue(await execute(message.value, controller.signal))
      })
    } catch (error) {
      process.send!({
        type: 'result',
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
        code: (error as { code?: string }).code
      })
    } finally {
      controllers.delete(message.id)
    }
  })
  executions.add(execution)
  void execution.finally(() => executions.delete(execution))
})
process.on('disconnect', () => {
  for (const c of controllers.values()) c.abort()
  void Promise.all([native?.music.dispose(), native?.model3d.dispose()]).finally(() =>
    process.exit(1)
  )
})
