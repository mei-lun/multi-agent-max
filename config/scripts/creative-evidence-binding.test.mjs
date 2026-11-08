import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evidenceMatches } from './creative-evidence-binding.mjs'
test('unbound, changed source, runtime and package manifests cannot pass as current', () => {
  const binding = {
    hostCommit: 'a',
    sourceFingerprint: 'b',
    platform: 'win32-x64',
    runtime: 'v24',
    packageManifestHashes: { image: 'c' }
  }
  assert.equal(evidenceMatches({ passed: true }, binding), false)
  assert.equal(evidenceMatches({ ...binding, passed: true }, binding), true)
  for (const key of Object.keys(binding))
    assert.equal(evidenceMatches({ ...binding, [key]: 'tampered' }, binding), false)
})
