export type AssetRef = { id: string; sha256: string; bytes: number; mime: string; filename: string }
export type CreativeRequest = {
  componentId: string
  componentVersion: string
  operation: string
  projectId: string
  attempt?: { id: string; serverId: string }
  idempotencyKey: string
  inputAssets: AssetRef[]
  params: Record<string, unknown>
}
export type JobState =
  | 'accepted'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancel-requested'
  | 'cancelled'
  | 'reconciliation-required'
export type JobEvent = { sequence: number; type: string; at: string; data?: unknown }
export type CreativeJob = {
  id: string
  request: CreativeRequest
  state: JobState
  events: JobEvent[]
}
import { z } from 'zod'
import { componentIdSchema, versionSchema } from '../components'
export const assetRefSchema = z
  .object({
    id: z.uuid(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().nonnegative().safe(),
    mime: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/),
    filename: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[\w. -]+$/)
      .refine((name) => name !== '.' && name !== '..')
  })
  .strict()
export const creativeRequestSchema = z
  .object({
    componentId: componentIdSchema,
    componentVersion: versionSchema,
    operation: z.string().min(1).max(160),
    projectId: z.string().min(1).max(512),
    attempt: z
      .object({ id: z.string().min(1), serverId: z.string().min(1) })
      .strict()
      .optional(),
    idempotencyKey: z.string().min(1).max(512),
    inputAssets: z.array(assetRefSchema).max(1000),
    params: z.record(z.string(), z.json())
  })
  .strict()
export const jobStateSchema = z.enum([
  'accepted',
  'running',
  'succeeded',
  'failed',
  'cancel-requested',
  'cancelled',
  'reconciliation-required'
])
export const jobEventSchema = z
  .object({
    sequence: z.number().int().positive(),
    type: z.string().min(1),
    at: z.iso.datetime(),
    data: z.json().optional()
  })
  .strict()
export const creativeJobSchema = z
  .object({
    id: z.uuid(),
    request: creativeRequestSchema,
    state: jobStateSchema,
    events: z.array(jobEventSchema).min(1)
  })
  .strict()
  .refine((job) => {
    if (
      !job.events.every((event, index) => event.sequence === index + 1) ||
      job.events[0]?.type !== 'accepted'
    )
      return false
    let state = 'accepted'
    for (const event of job.events.slice(1)) {
      if (['usage', 'asset', 'log'].includes(event.type)) {
        if (state !== 'running') return false
        continue
      }
      if (event.type === 'reconciled') {
        if (
          state !== 'reconciliation-required' ||
          !event.data ||
          typeof event.data !== 'object' ||
          Array.isArray(event.data) ||
          !['succeeded', 'failed', 'cancelled'].includes(String(event.data.outcome))
        )
          return false
        state = String(event.data.outcome)
        continue
      }
      const allowed: Record<string, string[]> = {
        accepted: ['running', 'cancelled', 'reconciliation-required'],
        running: ['succeeded', 'failed', 'cancel-requested', 'reconciliation-required'],
        'cancel-requested': ['reconciliation-required']
      }
      if (!allowed[state]?.includes(event.type)) return false
      state = event.type
    }
    return state === job.state
  }, 'Invalid job state/history')
export type Reconciliation = {
  outcome: 'succeeded' | 'failed' | 'cancelled'
  evidence: string
  actor: string
}
export type RuntimeDiagnostic = { jobId: string; message: string; at: string }
