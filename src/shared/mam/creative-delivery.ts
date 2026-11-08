import { z } from 'zod'

export const creativeDeliverySelection = z
  .object({
    workflowRunId: z.string().min(1).max(200),
    attemptId: z.string().min(1).max(200),
    contractId: z.string().min(1).max(200)
  })
  .strict()
export type CreativeDeliverySelection = z.infer<typeof creativeDeliverySelection>
export type CreativeDelivery = CreativeDeliverySelection & {
  title: string
  contentHash: string
  available: boolean
  files: number
  bytes: number
}
