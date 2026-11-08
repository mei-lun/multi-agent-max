import { z } from 'zod'
import { componentIdSchema } from '../../../shared/mam/components'
import { ArtifactRefSchema } from '../../../shared/mam/domain/artifact'
import { assetRefSchema } from '../../../shared/mam/creative-runtime'
import { AttemptResultSchema } from '../../../shared/mam/domain/attempt-result'
import type { PreparedAttempt } from './mam-attempt-execution-types'
import type { AttemptGatewayAuthority } from '../gateways/attempt-gateway-authority'
export const ComponentToolInvokeSchema = z
  .object({
    componentId: componentIdSchema,
    operation: z.string().min(1).max(160),
    params: z.record(z.string(), z.unknown()),
    inputArtifacts: z.array(ArtifactRefSchema).max(100),
    inputAssets: z.array(assetRefSchema).max(100).optional(),
    idempotencyKey: z.string().min(1).max(200)
  })
  .strict()
export const ComponentCapabilitySchema = z.object({
  componentId: componentIdSchema,
  version: z.string(),
  manifestHash: z.string().optional(),
  operations: z.array(z.string())
})
export const ComponentToolStatusSchema = z.object({
  jobId: z.uuid(),
  state: z.enum([
    'accepted',
    'running',
    'succeeded',
    'failed',
    'cancel-requested',
    'cancelled',
    'reconciliation-required'
  ]),
  assets: z.array(assetRefSchema).default([]),
  text: z.string().max(1000000).optional(),
  usage: AttemptResultSchema.shape.usage.optional()
})
export type ComponentToolPort = {
  publishOutputs?(request: { jobId: string; contractIds: string[] }): Promise<unknown>
  requestApproval?(input: {
    request: z.infer<typeof ComponentToolInvokeSchema>
    requestHash: string
    categories: string[]
  }): Promise<boolean>
  listCapabilities(): Promise<unknown>
  invoke(request: z.infer<typeof ComponentToolInvokeSchema>): Promise<{ jobId: string }>
  status(jobId: string): Promise<unknown>
  cancel(jobId: string): Promise<void>
  dispose(): Promise<void>
}
export type ComponentToolPortFactory = (input: {
  prepared: PreparedAttempt
  authority: AttemptGatewayAuthority
  signal: AbortSignal
}) => ComponentToolPort
