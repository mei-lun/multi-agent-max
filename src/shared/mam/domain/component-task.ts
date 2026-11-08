import { z } from 'zod'
import { componentIdSchema, versionSchema } from '../components'
import { creativeDraftRefSchema } from '../creative-draft'
export const ComponentTaskDescriptorSchema = z
  .object({
    id: componentIdSchema,
    version: versionSchema,
    hostApiVersion: versionSchema,
    operation: z.string().min(1).max(160),
    draft: creativeDraftRefSchema.optional(),
    params: z.record(z.string(), z.unknown())
  })
  .strict()
  .refine(
    (value) => JSON.stringify(value.params).length <= 1024 * 1024,
    'Component parameters exceed limit'
  )
export type ComponentTaskDescriptor = z.infer<typeof ComponentTaskDescriptorSchema>
