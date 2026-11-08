import { z } from 'zod'
import type { MusicResourceSpec } from '../../../shared/mam/music-native'

const hash = z.string().regex(/^[a-f0-9]{64}$/)
const component = z.object({
  unpackedBytes: z
    .number()
    .int()
    .positive()
    .max(40 * 1024 ** 3),
  sha256: hash,
  license: z.string().min(1),
  sources: z.array(z.string()).min(1),
  parts: z
    .array(
      z.object({
        name: z.string(),
        bytes: z.number().int().positive().max(1999999999),
        sha256: hash
      })
    )
    .min(1)
    .max(64)
})
const schema = z.object({
  schemaVersion: z.number().int(),
  resourceVersion: z.string(),
  releaseTag: z.string(),
  repository: z.string(),
  target: z.string(),
  modelRevision: z.string(),
  sourceRevision: z.string().optional(),
  vaeRevision: z.string().optional(),
  components: z.record(z.string(), component)
})

// The caller supplies trusted, pinned release coordinates; never derive them from downloaded data.
export function validateMusicManifest(
  bytes: Uint8Array,
  spec: MusicResourceSpec,
  names: readonly string[]
) {
  if (bytes.byteLength > 1024 * 1024) throw new Error('Music manifest exceeds size limit')
  const manifest = schema.parse(JSON.parse(Buffer.from(bytes).toString('utf8')))
  for (const key of [
    'schemaVersion',
    'resourceVersion',
    'releaseTag',
    'repository',
    'target',
    'modelRevision',
    'sourceRevision',
    'vaeRevision'
  ] as const)
    if (manifest[key] !== spec[key]) throw new Error(`Music resource version mismatch: ${key}`)
  if (
    names.length !== 2 ||
    Object.keys(manifest.components).length !== 2 ||
    names.some((name) => !Object.hasOwn(manifest.components, name))
  )
    throw new Error('Incomplete music resources')
  for (const [name, value] of Object.entries(manifest.components))
    value.parts.forEach((part, index) => {
      const expected = `music-workbench-${spec.resourceVersion}-${spec.target}-${name}.zip.part${String(index + 1).padStart(3, '0')}`
      if (part.name !== expected) throw new Error('Invalid music resource part')
    })
  return manifest
}
