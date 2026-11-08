import { z } from 'zod'
import { componentIdSchema } from '../components'
import { ModelProfileSchema, ProviderProfileSchema } from './execution-profile'
import { MamEntityIdSchema } from './primitives'
export const RoleComponentBindingSchema = z
  .object({
    componentId: componentIdSchema,
    modelProfileId: MamEntityIdSchema.optional(),
    allowedOperations: z.array(z.string().min(1).max(160)).min(1).optional()
  })
  .strict()
export const FrozenComponentBindingSchema = RoleComponentBindingSchema.extend({
  model: ModelProfileSchema.optional(),
  provider: ProviderProfileSchema.optional()
}).strict()
