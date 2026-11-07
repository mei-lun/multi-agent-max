import { z } from 'zod'
import { assetRefSchema } from './creative-runtime'
export { COMPONENT_HOST_CHANNEL } from './component-host-channel'
export const componentHostRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('context') }).strict(),
  z.object({ action: z.literal('importAsset') }).strict(),
  z.object({ action: z.literal('listJobs') }).strict(),
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
