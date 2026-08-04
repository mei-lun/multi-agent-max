import { z } from 'zod'

export const MamModelConnectionProtocolSchema = z.enum([
  'openai-responses',
  'openai-completions',
  'anthropic-messages',
  'google-generative-ai'
])

export const MamFetchModelCatalogInputSchema = z
  .object({
    protocol: MamModelConnectionProtocolSchema,
    baseUrl: z.url().optional(),
    apiKey: z.string().trim().min(1).max(20_000).optional()
  })
  .strict()

export const MamModelCatalogItemSchema = z
  .object({
    id: z.string().trim().min(1).max(400),
    displayName: z.string().trim().min(1).max(400).optional()
  })
  .strict()

export const MamModelCatalogResultSchema = z
  .object({ models: z.array(MamModelCatalogItemSchema).max(5_000) })
  .strict()

export type MamFetchModelCatalogInput = z.infer<typeof MamFetchModelCatalogInputSchema>
export type MamModelCatalogItem = z.infer<typeof MamModelCatalogItemSchema>
export type MamModelCatalogResult = z.infer<typeof MamModelCatalogResultSchema>
