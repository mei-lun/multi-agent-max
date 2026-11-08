import { z } from 'zod'
import { componentIdSchema, versionSchema } from './components'
import { assetRefSchema } from './creative-runtime'

export const creativeDraftRefSchema = z
  .object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict()
export const creativeDraftSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    projectId: z.string().min(1),
    jobId: z.uuid(),
    componentId: componentIdSchema,
    componentVersion: versionSchema,
    operation: z.string().min(1),
    assets: z.array(assetRefSchema).max(1000),
    result: z.json()
  })
  .strict()
export type CreativeDraftRef = z.infer<typeof creativeDraftRefSchema>
export type CreativeDraft = z.infer<typeof creativeDraftSchema> & CreativeDraftRef
export type CreativeDraftJob = {
  id: string
  componentId: string
  operation: string
  assetCount: number
  textPreview: string
}
