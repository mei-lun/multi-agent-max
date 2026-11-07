import { join } from 'node:path'
import { createMediaServices, type MediaCatalog } from '../media'
import { createCreativeTextServices } from '../creative-text'
import { createSpineNativeServices } from '../spine-native'
import { createDesktopMusicServices } from '../music-native/desktop'
import { createModel3dServices } from '../model3d-native'
import { rifeHandler } from '../spine-native/rife'
import { decodeImage } from './host-native-assets'
import { resolveHostVideoReceipt } from './host-video-receipts'
import type { CreativeMediaFactory } from './desktop-creative-services'
import { coordinateGpuHandler } from './gpu-job-coordinator'

export type DesktopMediaDependencies = {
  catalog: MediaCatalog
  resolveSecret(reference: string): string | undefined
}
export function creativeFactory(
  mamRoot: string,
  media: DesktopMediaDependencies
): CreativeMediaFactory {
  return (assets, lookupJob, host) => {
    const generation = createMediaServices({
      ...media,
      assets,
      validateImage: decodeImage,
      resolveVideoReceipt: (sourceId, request) =>
        resolveHostVideoReceipt(lookupJob, sourceId, request)
    })
    const text = createCreativeTextServices({ ...media, assets, validateImage: decodeImage })
    const spine = createSpineNativeServices({
      assets,
      validateImage: decodeImage,
      receiptDirectory: join(mamRoot, 'spine-receipts')
    })
    const music = createDesktopMusicServices({ root: host.root, registry: host.registry, assets })
    const model3d = createModel3dServices({
      root: host.root,
      registry: host.registry,
      assets,
      validateImage: decodeImage,
      version: '0.1.42'
    })
    const rife = (request: Parameters<typeof rifeHandler>[0]) =>
      request.operation === 'spine.rife.frame'
        ? {
            validate() {},
            async run(
              accepted: Parameters<typeof rifeHandler>[0],
              context: Parameters<ReturnType<typeof rifeHandler>['run']>[1]
            ) {
              const config = await host.rifeSettings.get()
              if (!config)
                throw new Error('请先在工作台配置本地 RIFE 程序和模型 / Configure local RIFE first')
              const handler = rifeHandler(accepted, { assets, validateImage: decodeImage, config })
              handler.validate(accepted)
              return handler.run(accepted, context)
            }
          }
        : undefined
    return {
      listModels: () => [...generation.listModels(), ...text.listModels()],
      handlers: (request) =>
        coordinateGpuHandler(
          mamRoot,
          request.operation,
          generation.handlers(request) ??
            text.handlers(request) ??
            spine.handlers(request) ??
            rife(request) ??
            music.handlers(request) ??
            model3d.handlers(request)
        ),
      dispose: async () => {
        await music.dispose()
        await model3d.dispose()
      }
    }
  }
}
