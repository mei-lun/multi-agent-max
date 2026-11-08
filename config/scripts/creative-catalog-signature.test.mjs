import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { signCatalog, verifyCatalog } from './creative-catalog-signature.mjs'
test('external trust, deterministic signing, tamper and wrong key rejection', () => {
  const keys = generateKeyPairSync('ed25519'),
    other = generateKeyPairSync('ed25519')
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' })
  const catalog = {
    schemaVersion: 1,
    packages: [{ id: 'creative.image', version: '1.0.0', manifestSha256: 'a'.repeat(64) }]
  }
  const signed = signCatalog(catalog, 'local-test', keys.privateKey)
  assert.equal(signed.signature, signCatalog(catalog, 'local-test', keys.privateKey).signature)
  assert.deepEqual(verifyCatalog(signed, { 'local-test': publicKey }), catalog)
  assert.throws(() => verifyCatalog(signed, {}), /Untrusted/)
  assert.throws(
    () =>
      verifyCatalog(signed, {
        'local-test': other.publicKey.export({ type: 'spki', format: 'pem' })
      }),
    /signature/
  )
  signed.catalog.packages[0].version = '0.9.0'
  assert.throws(() => verifyCatalog(signed, { 'local-test': publicKey }), /signature/)
})
