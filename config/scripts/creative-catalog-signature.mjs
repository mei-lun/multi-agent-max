import { createHash, createPublicKey, sign, verify } from 'node:crypto'
export const canonicalCatalog = (value) =>
  JSON.stringify(value, (_, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b, 'en')))
      : item
  )
export const manifestHash = (manifest) =>
  createHash('sha256').update(canonicalCatalog(manifest)).digest('hex')
export function signCatalog(catalog, keyId, privateKey) {
  return {
    catalog,
    keyId,
    signature: sign(null, Buffer.from(canonicalCatalog(catalog)), privateKey).toString('base64')
  }
}
export function verifyCatalog(envelope, trustedKeys) {
  if (
    !envelope ||
    Object.keys(envelope).sort().join() !== 'catalog,keyId,signature' ||
    envelope.catalog?.schemaVersion !== 1 ||
    !Array.isArray(envelope.catalog.packages) ||
    !envelope.catalog.packages.length
  )
    throw Error('Invalid signed catalog')
  const pem = trustedKeys[envelope.keyId]
  if (!pem) throw Error('Untrusted catalog key')
  const key = createPublicKey(pem)
  if (
    key.asymmetricKeyType !== 'ed25519' ||
    !verify(
      null,
      Buffer.from(canonicalCatalog(envelope.catalog)),
      key,
      Buffer.from(envelope.signature, 'base64')
    )
  )
    throw Error('Invalid catalog signature')
  const seen = new Set()
  for (const entry of envelope.catalog.packages) {
    if (
      !/^creative\.[a-z0-9]+$/.test(entry.id) ||
      !/^\d+\.\d+\.\d+$/.test(entry.version) ||
      !/^[a-f0-9]{64}$/.test(entry.manifestSha256) ||
      seen.has(entry.id)
    )
      throw Error('Invalid catalog package')
    seen.add(entry.id)
  }
  return structuredClone(envelope.catalog)
}
