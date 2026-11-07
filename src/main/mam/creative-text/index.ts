import type { MediaCatalog } from '../media'
import { classifyMediaModel } from '../media/native'
import type { HandlerRegistry } from '../creative-runtime/jobs'
import { creativeTextParamsSchema, type CreativeTextModel } from '../../../shared/mam/creative-text'
import type { ModelProfile } from '../../../shared/mam/domain/execution-profile'
import { executeText } from './transport'
import type { BinaryAssetStore } from '../creative-runtime/assets'

export function createCreativeTextServices(options: {
  catalog: MediaCatalog
  resolveSecret: (ref: string) => string | undefined
  fetch?: typeof fetch
  assets?: BinaryAssetStore
  validateImage?: (bytes: Buffer) => string
}) {
  const eligible = (model: ModelProfile) => {
    const provider = options.catalog.providers.getActive(model.providerProfileId)
    return (
      provider &&
      provider.protocol !== 'executor-native' &&
      model.capabilities.modalities.includes('text') &&
      !classifyMediaModel(model, provider)
    )
  }
  const listModels = (): CreativeTextModel[] =>
    options.catalog.models
      .listActive()
      .filter(eligible)
      .map((model) => ({
        id: model.id,
        label: model.displayName,
        modelId: model.remoteModelId,
        kind: 'text',
        operations: model.capabilities.modalities.includes('image')
          ? ['text.generate', 'vision.generate']
          : ['text.generate'],
        supportsVision: model.capabilities.modalities.includes('image')
      }))
  const handlers: HandlerRegistry = (request) => {
    if (!['text.generate', 'vision.generate'].includes(request.operation)) return
    const params = creativeTextParamsSchema.parse(request.params)
    const model = options.catalog.models.getActive(params.modelProfileId)
    if (!model || !eligible(model)) throw new Error('Unsupported text model')
    const vision = request.operation === 'vision.generate'
    if (
      vision &&
      (!model.capabilities.modalities.includes('image') ||
        !options.assets ||
        !options.validateImage)
    )
      throw new Error('Vision unavailable for model')
    const refs = structuredClone(request.inputAssets)
    const validate = () => {
      if (!vision && refs.length) throw new Error('Text inputs must be prompt only')
      if (
        vision &&
        (!refs.length ||
          refs.length > 16 ||
          refs.some((ref) => ref.bytes > 32 * 1024 * 1024) ||
          refs.reduce((sum, ref) => sum + ref.bytes, 0) > 64 * 1024 * 1024)
      )
        throw new Error('Vision image budget exceeded')
    }
    validate()
    const provider = structuredClone(options.catalog.providers.getActive(model.providerProfileId)!)
    const snapshot = structuredClone(model)
    const secret = provider.secretRef ? options.resolveSecret(provider.secretRef) : undefined
    if (provider.secretRef && !secret) throw new Error('Text credential unavailable')
    return {
      validate,
      run: async (_accepted, context) => {
        const images = []
        for (const ref of refs) {
          context.signal.throwIfAborted()
          const bytes = await options.assets!.read(ref)
          const mime = options.validateImage!(bytes)
          if (
            !['image/png', 'image/jpeg', 'image/webp'].includes(mime) ||
            bytes.length !== ref.bytes
          )
            throw new Error('Invalid vision image')
          images.push({ mime, data: bytes.toString('base64') })
        }
        return executeText({
          model: snapshot,
          provider,
          secret,
          params,
          fetcher: options.fetch ?? fetch,
          context,
          images
        })
      }
    }
  }
  return { listModels, handlers }
}
