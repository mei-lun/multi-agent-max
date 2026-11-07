import type { ModelProfile, ProviderProfile } from '../../../shared/mam/domain/execution-profile'
import type { MediaModel } from '../../../shared/mam/media-models'
import { mediaParamsSchema } from '../../../shared/mam/media-requests'
import type { HandlerRegistry } from '../creative-runtime/jobs'
import type { BinaryAssetStore } from '../creative-runtime/assets'
import { execute } from './transport'
import { classifyMediaModel } from './native'
import { createVideoHandler, videoModel, type VideoReceipt } from './video'
import { videoParamsSchema, videoRefreshSchema } from '../../../shared/mam/video-requests'
import type { CreativeRequest } from '../../../shared/mam/creative-runtime'
export type { VideoReceipt } from './video'
export { classifyMediaModel } from './native'

export type MediaCatalog = {
  models: { listActive(): readonly ModelProfile[]; getActive(id: string): ModelProfile | undefined }
  providers: { getActive(id: string): ProviderProfile | undefined }
}
export function createMediaServices(options: {
  catalog: MediaCatalog
  resolveSecret: (ref: string) => string | undefined
  assets: BinaryAssetStore
  fetch?: typeof fetch
  validateImage?: (bytes: Buffer) => string
  resolveVideoReceipt?: (sourceJobId: string, request: CreativeRequest) => VideoReceipt | undefined
}) {
  const classify = (model: ModelProfile): MediaModel | undefined => {
    const provider = options.catalog.providers.getActive(model.providerProfileId)
    if (provider && videoModel(model, provider))
      return {
        id: model.id,
        label: model.displayName,
        modelId: model.remoteModelId,
        kind: 'video',
        supportsVideoModes: /^grok-/i.test(model.remoteModelId)
          ? ['text', 'image', 'reference', 'video']
          : /^(minimax-h3|seedance-)/i.test(model.remoteModelId)
            ? ['text', 'image', 'first_last', 'reference']
            : ['text'],
        operations: [
          'video.generate',
          ...(/^grok-/i.test(model.remoteModelId) ? ['video.edit'] : [])
        ]
      }
    return provider ? classifyMediaModel(model, provider) : undefined
  }
  const listModels = () => options.catalog.models.listActive().flatMap((m) => classify(m) ?? [])
  const handlers: HandlerRegistry = (request) => {
    if (['video.generate', 'video.edit', 'video.refresh'].includes(request.operation)) {
      const receipt =
        request.operation === 'video.refresh'
          ? options.resolveVideoReceipt?.(
              videoRefreshSchema.parse(request.params).sourceJobId,
              request
            )
          : undefined
      if (request.operation === 'video.refresh' && !receipt)
        throw new Error('Trusted video receipt required')
      const model = structuredClone(
        receipt?.model ??
          options.catalog.models.getActive(videoParamsSchema.parse(request.params).modelProfileId)
      )
      if (!model) throw new Error('Unknown video model')
      const provider = structuredClone(
        receipt?.provider ?? options.catalog.providers.getActive(model.providerProfileId)
      )
      if (!provider || !videoModel(model, provider))
        throw new Error('Unsupported video provider/model')
      const secret = provider.secretRef ? options.resolveSecret(provider.secretRef) : undefined
      if (provider.secretRef && !secret) throw new Error('Video credential unavailable')
      return createVideoHandler({
        request,
        model,
        provider,
        secret,
        assets: options.assets,
        fetcher: options.fetch ?? fetch,
        ...(receipt ? { receipt } : {}),
        ...(options.validateImage ? { validateImage: options.validateImage } : {})
      })
    }
    if (!['image.generate', 'image.edit', 'speech.generate'].includes(request.operation)) return
    const params = mediaParamsSchema.parse(request.params)
    const model = options.catalog.models.getActive(params.modelProfileId)
    if (!model || !classify(model)?.operations.includes(request.operation))
      throw new Error('Unsupported media model or protocol')
    if (params.outputFormat && !classify(model)?.outputFormats?.includes(params.outputFormat))
      throw new Error('Unsupported model output format')
    const provider = structuredClone(options.catalog.providers.getActive(model.providerProfileId)!)
    const secret = provider.secretRef ? options.resolveSecret(provider.secretRef) : undefined
    if (provider.secretRef && !secret) throw new Error('Media credential unavailable')
    const snapshot = structuredClone(model)
    return {
      validate() {
        if (request.operation !== 'image.edit' && request.inputAssets.length)
          throw new Error('Unexpected input assets')
        if (request.operation === 'image.edit' && !request.inputAssets.length)
          throw new Error('Edit requires images')
        if (params.maskAssetId && !request.inputAssets.some((a) => a.id === params.maskAssetId))
          throw new Error('Mask must be an input asset')
      },
      run: (accepted, context) =>
        execute({
          request: accepted,
          params,
          model: snapshot,
          provider,
          secret,
          assets: options.assets,
          fetcher: options.fetch ?? fetch,
          ...(options.validateImage ? { validateImage: options.validateImage } : {}),
          context
        })
    }
  }
  return { listModels, handlers }
}
