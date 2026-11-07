import { z } from 'zod'
export const BinaryLogicalPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (path) =>
      !/[\\:<>"|?*]/.test(path) &&
      [...path].every((character) => character.charCodeAt(0) >= 32) &&
      path
        .split('/')
        .every(
          (part) =>
            !!part &&
            part !== '.' &&
            part !== '..' &&
            !/[. ]$/.test(part) &&
            !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
        ),
    'Unsafe binary path'
  )
export const AssetBundleSchema = z
  .object({
    version: z.literal(1),
    source: z
      .object({
        componentId: z.string().min(1).max(200),
        componentVersion: z.string().min(1).max(100),
        operation: z.string().max(200).optional()
      })
      .strict(),
    files: z
      .array(
        z
          .object({
            logicalPath: BinaryLogicalPathSchema,
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            bytes: z
              .number()
              .int()
              .nonnegative()
              .max(2 * 1024 ** 3),
            mime: z
              .string()
              .max(200)
              .regex(/^[\w.+-]+\/[\w.+-]+$/),
            storageRef: z.string().regex(/^sha256:[a-f0-9]{64}$/)
          })
          .strict()
      )
      .min(1)
      .max(10000)
  })
  .strict()
  .superRefine((bundle, ctx) => {
    const paths = new Set<string>()
    for (const file of bundle.files) {
      const path = file.logicalPath.toLowerCase()
      if (paths.has(path) || file.storageRef !== `sha256:${file.sha256}`)
        ctx.addIssue({ code: 'custom', message: 'Duplicate path or mismatched storage reference' })
      paths.add(path)
    }
    for (const path of paths) {
      const parts = path.split('/')
      parts.pop()
      while (parts.length) {
        if (paths.has(parts.join('/')))
          ctx.addIssue({ code: 'custom', message: 'File/directory collision' })
        parts.pop()
      }
    }
    if (bundle.files.reduce((n, file) => n + file.bytes, 0) > 8 * 1024 ** 3)
      ctx.addIssue({ code: 'custom', message: 'Bundle exceeds limit' })
  })
export type AssetBundle = z.infer<typeof AssetBundleSchema>
