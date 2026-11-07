import type { ModelProfile, ProviderProfile } from '../../../shared/mam/domain/execution-profile'
import type { MediaModel } from '../../../shared/mam/media-models'
import { mediaParamsSchema } from '../../../shared/mam/media-requests'
import type { HandlerRegistry } from '../creative-runtime/jobs'
import type { BinaryAssetStore } from '../creative-runtime/assets'
import { execute } from './transport'
import { classifyMediaModel } from './native'
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
}) {
  const classify = (model: ModelProfile): MediaModel | undefined => {
    const provider = options.catalog.providers.getActive(model.providerProfileId)
    return provider ? classifyMediaModel(model, provider) : undefined
  }
  const listModels = () => options.catalog.models.listActive().flatMap((m) => classify(m) ?? [])
  const handlers: HandlerRegistry = (request) => {
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
