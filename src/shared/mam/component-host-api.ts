import { z } from 'zod'
import { assetRefSchema } from './creative-runtime'
import { constellationCall } from './constellation-tools'
import { componentIdSchema } from './components'
export { COMPONENT_HOST_CHANNEL } from './component-host-channel'
export const componentHostRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('context') }).strict(),
  z.object({ action: z.literal('listModels') }).strict(),
  z.object({ action: z.literal('listComponents') }).strict(),
  z.object({ action: z.literal('openComponent'), componentId: componentIdSchema }).strict(),
  z
    .object({
      action: z.literal('readAssetText'),
      ref: assetRefSchema,
      maxBytes: z.number().int().min(1).max(1048576).default(1048576)
    })
    .strict(),
  z.object({ action: z.literal('listConversations') }).strict(),
  z.object({ action: z.literal('getConversation'), conversationId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal('runConversation'),
      conversationId: z.uuid().optional(),
      invocationId: z.uuid(),
      modelProfileId: z.string().min(1),
      command: z.string().min(1).max(100000),
      context: z.string().max(100000).optional(),
      inputAssets: z.array(assetRefSchema).max(16).default([])
    })
    .strict(),
  z.object({ action: z.literal('toolCheck'), call: constellationCall }).strict(),
  z.object({ action: z.literal('toolExecute'), token: z.uuid() }).strict(),
  z.object({ action: z.literal('configureRife') }).strict(),
  z
    .object({
      action: z.literal('listProjectMedia'),
      kind: z.enum(['image', 'audio', 'video']),
      limit: z.number().int().min(1).max(100).default(24)
    })
    .strict(),
  z.object({ action: z.literal('previewAsset'), ref: assetRefSchema }).strict(),
  z.object({ action: z.literal('exportAsset'), ref: assetRefSchema }).strict(),
  z
    .object({
      action: z.literal('storeImage'),
      bytes: z.union([
        z.instanceof(Uint8Array),
        z.array(z.number().int().min(0).max(255)).max(33554432)
      ]),
      filename: z.string().min(1).max(160)
    })
    .strict(),
  z
    .object({ action: z.literal('importAsset'), kind: z.enum(['media', 'file']).optional() })
    .strict(),
  z.object({ action: z.literal('listJobs') }).strict(),
  z.object({ action: z.literal('deleteJob'), jobId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal('submit'),
      operation: z.string().min(1),
      idempotencyKey: z.string().min(1),
      params: z.record(z.string(), z.json()),
      inputAssets: z.array(assetRefSchema).max(1000)
    })
    .strict(),
  z
    .object({
      action: z.literal('events'),
      jobId: z.uuid(),
      afterSequence: z.number().int().nonnegative()
    })
    .strict(),
  z.object({ action: z.literal('cancel'), jobId: z.uuid() }).strict()
])
export type ComponentHostRequest = z.infer<typeof componentHostRequestSchema>
export type ComponentHostApi = { request(input: ComponentHostRequest): Promise<unknown> }
