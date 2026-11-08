import { z } from 'zod'

export const mediaParamsSchema = z
  .object({
    modelProfileId: z.string().min(1),
    prompt: z.string().min(1).max(32000),
    size: z.string().max(40).optional(),
    quality: z.string().max(40).optional(),
    outputFormat: z
      .enum(['png', 'jpeg', 'webp', 'mp3', 'wav', 'opus', 'aac', 'flac', 'pcm'])
      .optional(),
    count: z.number().int().min(1).max(10).optional(),
    voice: z.string().max(100).optional(),
    background: z.enum(['auto', 'transparent', 'opaque']).optional(),
    instructions: z.string().max(16000).optional(),
    maskAssetId: z.string().optional()
  })
  .strict()
