import { z } from 'zod'

export const creativeTextParamsSchema = z
  .object({
    modelProfileId: z.string().min(1),
    prompt: z.string().min(1).max(1000000),
    systemPrompt: z.string().max(100000).optional(),
    reasoningEffort: z.enum(['low', 'medium', 'high']).optional()
  })
  .strict()
export type CreativeTextParams = z.infer<typeof creativeTextParamsSchema>
export type CreativeTextModel = {
  id: string
  label: string
  modelId: string
  kind: 'text'
  operations: ('text.generate' | 'vision.generate')[]
  supportsVision: boolean
}
