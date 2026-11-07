import { z } from 'zod'
export const constellationCall = z.discriminatedUnion('name', [
  z
    .object({
      name: z.literal('read_file'),
      args: z
        .object({ path: z.string().max(4096), encoding: z.enum(['utf-8', 'gbk']).optional() })
        .strict()
    })
    .strict(),
  z
    .object({
      name: z.literal('list_files'),
      args: z.object({ path: z.string().max(4096).optional() }).strict()
    })
    .strict(),
  z
    .object({
      name: z.literal('search_files'),
      args: z
        .object({ path: z.string().max(4096).optional(), query: z.string().min(1).max(200) })
        .strict()
    })
    .strict(),
  z
    .object({ name: z.literal('web_fetch'), args: z.object({ url: z.url().max(4096) }).strict() })
    .strict(),
  z
    .object({
      name: z.literal('run_command'),
      args: z
        .object({ command: z.string().min(1).max(8000), workdir: z.string().max(4096).optional() })
        .strict()
    })
    .strict()
])
export type ConstellationCall = z.infer<typeof constellationCall>
export type ConstellationContext = { componentId: string; projectId: string; windowId: number }
