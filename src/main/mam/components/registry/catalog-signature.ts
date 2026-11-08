import { createHash, createPublicKey, verify } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
  componentIdSchema,
  versionSchema,
  componentManifestSchema
} from '../../../../shared/mam/components'
import type { ComponentRegistry } from './index'
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b, 'en')))
      : item
  )
const schema = z
  .object({
    keyId: z.string().min(1),
    signature: z.string().min(1),
    catalog: z
      .object({
        schemaVersion: z.literal(1),
        packages: z
          .array(
            z
              .object({
                id: componentIdSchema,
                version: versionSchema,
                manifestSha256: z.string().regex(/^[a-f0-9]{64}$/)
              })
              .strict()
          )
          .min(1)
      })
      .strict()
  })
  .strict()
export function verifySignedCatalog(input: unknown, trustedKeys: Readonly<Record<string, string>>) {
  const envelope = schema.parse(input),
    pem = trustedKeys[envelope.keyId]
  if (!pem) throw new Error('Untrusted catalog key')
  const key = createPublicKey(pem)
  if (
    key.asymmetricKeyType !== 'ed25519' ||
    !verify(
      null,
      Buffer.from(canonical(envelope.catalog)),
      key,
      Buffer.from(envelope.signature, 'base64')
    )
  )
    throw new Error('Invalid catalog signature')
  if (new Set(envelope.catalog.packages.map((p) => p.id)).size !== envelope.catalog.packages.length)
    throw new Error('Duplicate catalog component')
  return envelope.catalog
}
export async function installSignedCatalogPackage(options: {
  registry: ComponentRegistry
  envelope: unknown
  trustedKeys: Readonly<Record<string, string>>
  sourceDirectory: string
}) {
  const catalog = verifySignedCatalog(options.envelope, options.trustedKeys)
  const manifest = componentManifestSchema.parse(
    JSON.parse(await readFile(join(options.sourceDirectory, 'manifest.json'), 'utf8'))
  )
  const hash = createHash('sha256').update(canonical(manifest)).digest('hex')
  if (
    !catalog.packages.some(
      (p) => p.id === manifest.id && p.version === manifest.version && p.manifestSha256 === hash
    )
  )
    throw new Error('Package not authorized by signed catalog')
  // Installation never activates or downgrades an active version; activation is explicit.
  return options.registry.install(
    { sourceDirectory: options.sourceDirectory, trustLocal: true },
    (current) => {
      if (createHash('sha256').update(canonical(current)).digest('hex') !== hash)
        throw new Error('Signed manifest changed before installation')
    }
  )
}
