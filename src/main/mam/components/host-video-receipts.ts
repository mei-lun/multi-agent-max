import { z } from 'zod'
import type { CreativeJob, CreativeRequest } from '../../../shared/mam/creative-runtime'
import {
  ModelProfileSchema,
  ProviderProfileSchema
} from '../../../shared/mam/domain/execution-profile'
import { videoParamsSchema, videoRefreshSchema } from '../../../shared/mam/video-requests'
import { videoModel, type VideoReceipt } from '../media/video'
import { validOperation } from '../media/video-protocol'

const receiptSchema = z
  .object({
    type: z.literal('remote_task'),
    remoteId: z.string().max(300),
    model: ModelProfileSchema,
    provider: ProviderProfileSchema
  })
  .strict()

/** Only durable host job events can authorize querying an existing remote task. */
export function resolveHostVideoReceipt(
  lookupJob: (id: string) => CreativeJob | undefined,
  sourceJobId: string,
  request: CreativeRequest
): VideoReceipt | undefined {
  const refresh = videoRefreshSchema.safeParse(request.params)
  if (
    request.operation !== 'video.refresh' ||
    !refresh.success ||
    refresh.data.sourceJobId !== sourceJobId ||
    request.inputAssets.length
  )
    return
  const source = lookupJob(sourceJobId)
  if (
    !source ||
    source.request.projectId !== request.projectId ||
    source.request.componentId !== request.componentId ||
    source.request.componentVersion !== request.componentVersion ||
    !['video.generate', 'video.edit'].includes(source.request.operation)
  )
    return
  const params = videoParamsSchema.safeParse(source.request.params)
  if (!params.success) return
  for (const event of source.events) {
    if (event.type !== 'log') continue
    const receipt = receiptSchema.safeParse(event.data)
    if (!receipt.success) continue
    const { model, provider } = receipt.data
    if (provider.protocol === 'google-generative-ai') {
      if (
        !validOperation(receipt.data.remoteId) ||
        receipt.data.remoteId.replace(/^v1beta\//, '').split('/')[1] !== model.remoteModelId
      )
        return
    } else if (!/^[-\w]{1,200}$/.test(receipt.data.remoteId)) return
    if (
      model.id !== params.data.modelProfileId ||
      model.providerProfileId !== provider.id ||
      !videoModel(model, provider) ||
      (provider.headers && Object.values(provider.headers).some(Boolean))
    )
      return
    if (provider.baseUrl) {
      const url = new URL(provider.baseUrl)
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        return
    }
    return structuredClone(receipt.data)
  }
}
