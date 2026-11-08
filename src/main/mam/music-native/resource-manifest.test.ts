import { expect, test } from 'vitest'
import { validateMusicManifest } from './resource-manifest'

test('pinned manifest rejects release substitution, traversal and oversized parts', () => {
  const spec = {
    schemaVersion: 1,
    resourceVersion: 'v',
    releaseTag: 'release',
    repository: 'owner/repo',
    target: 'windows-x64-cu128',
    modelRevision: 'revision'
  }
  const entry = (name: string) => ({
    unpackedBytes: 1,
    sha256: 'a'.repeat(64),
    license: 'MIT',
    sources: ['source'],
    parts: [
      {
        name: `music-workbench-v-windows-x64-cu128-${name}.zip.part001`,
        bytes: 1,
        sha256: 'b'.repeat(64)
      }
    ]
  })
  const fixture = { ...spec, components: { runtime: entry('runtime'), model: entry('model') } }
  const check = (value: unknown) =>
    validateMusicManifest(Buffer.from(JSON.stringify(value)), spec, ['runtime', 'model'])
  expect(check(fixture).components.runtime!.parts).toHaveLength(1)
  expect(() => check({ ...fixture, repository: 'attacker/repo' })).toThrow()
  fixture.components.runtime.parts[0]!.name = '../escape'
  expect(() => check(fixture)).toThrow()
  fixture.components.runtime = entry('runtime')
  fixture.components.runtime.parts[0]!.bytes = 2000000000
  expect(() => check(fixture)).toThrow()
})
