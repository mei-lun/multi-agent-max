import { z } from 'zod'
export const videoParamsSchema = z
  .object({
    modelProfileId: z.string().min(1),
    prompt: z.string().min(1).max(16000),
    mode: z.enum(['text', 'image', 'first_last', 'reference', 'video']),
    duration: z.number().int().min(1).max(30).optional(),
    resolution: z.enum(['480p', '720p', '1080p']).optional(),
    aspectRatio: z.enum(['16:9', '9:16', '1:1']).optional()
  })
  .strict()
export const videoRefreshSchema = z.object({ sourceJobId: z.string().min(1) }).strict()
