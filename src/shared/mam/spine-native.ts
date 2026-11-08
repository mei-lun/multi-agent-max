import { z } from 'zod'
export const spineSettingsSchema = z
  .object({
    endpoint: z.string().optional(),
    layerModel: z.string().min(1).max(256),
    depthModel: z.string().min(1).max(256),
    resolution: z.union([z.literal(512), z.literal(768), z.literal(1024), z.literal(1280)]),
    steps: z.number().int().min(1).max(100),
    seed: z.number().int().min(0).max(4294967295),
    quant: z.enum(['none', 'nf4']),
    groupOffload: z.boolean()
  })
  .strict()
const jobId = z.string().regex(/^[a-f0-9]{32}$/)
const promptId = z.string().regex(/^[\w-]{1,100}$/)
export const spineComfySchema = z
  .object({
    endpoint: z.string(),
    operation: z.enum(['info', 'upload', 'submit', 'history', 'recover', 'image']),
    payload: z.record(z.string(), z.unknown())
  })
  .strict()
export const spinePayloads = {
  info: z.object({}).strict(),
  upload: z.object({ jobId }).strict(),
  submit: z.object({ jobId, config: spineSettingsSchema }).strict(),
  history: z.object({ promptId }).strict(),
  recover: z.object({ jobId }).strict(),
  image: z.object({ jobId, filename: z.string().max(100) }).strict()
}
export const spineRifeSchema = z
  .object({ fraction: z.number().gt(0).lt(1), gpu: z.number().int().min(-1).max(7) })
  .strict()
