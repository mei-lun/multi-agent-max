import { z } from 'zod'

export const componentIdSchema = z.enum([
  'creative.image',
  'creative.video',
  'creative.speech',
  'creative.music',
  'creative.writing',
  'creative.spine',
  'creative.model3d',
  'creative.constellation'
])
export type ComponentId = z.infer<typeof componentIdSchema>
export const versionSchema = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
export const relativePathSchema = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (p) =>
      !p.includes('\\') &&
      !p.includes(':') &&
      !/[<>"|?*]/.test(p) &&
      [...p].every((character) => character.charCodeAt(0) >= 32) &&
      p
        .split('/')
        .every(
          (s) =>
            !!s &&
            s !== '.' &&
            s !== '..' &&
            !/[. ]$/.test(s) &&
            !/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(s)
        ),
    'Unsafe package path'
  )
export const componentManifestSchema = z
  .object({
    id: componentIdSchema,
    version: versionSchema,
    hostApiVersion: versionSchema,
    minimumHostVersion: versionSchema,
    platforms: z
      .array(
        z
          .object({ os: z.enum(['darwin', 'linux', 'win32']), arch: z.enum(['arm64', 'x64']) })
          .strict()
      )
      .min(1),
    source: z
      .object({
        commit: z.string().regex(/^[a-f0-9]{40,64}$/),
        sha256: z.string().regex(/^[a-f0-9]{64}$/)
      })
      .strict(),
    files: z
      .record(relativePathSchema, z.string().regex(/^[a-f0-9]{64}$/))
      .refine(
        (f) =>
          Object.keys(f).length > 0 &&
          Object.keys(f).length <= 1000 &&
          new Set(Object.keys(f).map((p) => p.toLowerCase())).size === Object.keys(f).length
      ),
    uiEntrypoint: relativePathSchema,
    runtimeEntrypoint: relativePathSchema,
    dependencies: z
      .array(z.object({ id: componentIdSchema, version: versionSchema }).strict())
      .max(8),
    resources: z.array(z.string().min(1)).max(100),
    operations: z
      .array(
        z
          .object({
            id: z.string().min(1),
            title: z.string().min(1),
            description: z.string(),
            requiredCapabilities: z.array(z.string().min(1))
          })
          .strict()
      )
      .min(1)
  })
  .strict()
  .refine(
    (m) =>
      !!m.files[m.uiEntrypoint] &&
      !!m.files[m.runtimeEntrypoint] &&
      new Set(m.operations.map((o) => o.id)).size === m.operations.length &&
      new Set(m.dependencies.map((d) => d.id)).size === m.dependencies.length &&
      !m.dependencies.some((d) => d.id === m.id)
  )
export type ComponentManifest = z.infer<typeof componentManifestSchema>
export type ComponentCatalogEntry = {
  id: ComponentId
  distribution: 'local-import-only'
  available: boolean
  versions: {
    manifest: ComponentManifest
    verification: 'trusted-local-import'
    enabled: boolean
    status: 'unsupported' | 'resources-missing' | 'installed'
    missingResources: string[]
  }[]
}
export const componentInstallRequestSchema = z
  .object({ sourceDirectory: z.string().min(1), trustLocal: z.literal(true) })
  .strict()
export const componentVersionRequestSchema = z
  .object({ id: componentIdSchema, version: versionSchema })
  .strict()
export const componentIdRequestSchema = z.object({ id: componentIdSchema }).strict()
export const componentCatalog = componentIdSchema.options.map((id) => ({
  id,
  distribution: 'local-import-only' as const
}))
