import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ExecutorProfileSchema,
  ProviderProfileSchema
} from '../../../shared/mam/domain/execution-profile'
import { VersionedProfileRegistry } from './versioned-profile-registry'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('VersionedProfileRegistry', () => {
  it('keeps versions immutable and changes active version explicitly', async () => {
    const root = await createRoot()
    const registry = new VersionedProfileRegistry(root, ProviderProfileSchema)
    registry.save(provider(1))
    registry.save(provider(2), false)
    expect(registry.getActive('provider.openai')?.version).toBe(1)
    expect(registry.listVersions('provider.openai').map((item) => item.version)).toEqual([1, 2])
    registry.activate('provider.openai', 2)
    expect(registry.getActive('provider.openai')?.version).toBe(2)
    expect(() => registry.save(provider(2))).toThrow(
      expect.objectContaining({ code: 'profile_version_exists' })
    )
  })

  it('restores active versions and stable content hashes after restart', async () => {
    const root = await createRoot()
    const first = new VersionedProfileRegistry(root, ProviderProfileSchema)
    const saved = first.save(provider(1))
    const hash = first.contentHash(saved)
    const restarted = new VersionedProfileRegistry(root, ProviderProfileSchema)
    expect(restarted.getActive('provider.openai')).toEqual(saved)
    expect(restarted.listActive()).toEqual([saved])
    expect(restarted.contentHash(saved)).toBe(hash)
  })

  it('deactivates a Role without deleting its immutable versions', async () => {
    const registry = new VersionedProfileRegistry(await createRoot(), ProviderProfileSchema)
    const saved = registry.save(provider(1))
    registry.deactivate(saved.id)
    expect(registry.getActive(saved.id)).toBeUndefined()
    expect(registry.listVersions(saved.id)).toEqual([saved])
  })

  it('rejects secret values and accepts only secret references', async () => {
    const registry = new VersionedProfileRegistry(await createRoot(), ProviderProfileSchema)
    expect(() => registry.save({ ...provider(1), secretValue: 'plaintext' })).toThrow()
    expect(registry.save(provider(1))).toMatchObject({ secretRef: 'secret.openai' })

    const executors = new VersionedProfileRegistry(await createRoot(), ExecutorProfileSchema)
    expect(() =>
      executors.save({
        id: 'executor.codex',
        version: 1,
        kind: 'codex-cli',
        executableRef: 'codex',
        adapterOptions: { apiKey: 'secret-value-canary' }
      })
    ).toThrow(expect.objectContaining({ code: 'plaintext_secret_forbidden' }))
  })
})

function provider(version: number) {
  return {
    id: 'provider.openai',
    version,
    protocol: 'openai-responses',
    baseUrl: 'https://api.example.test/v1',
    secretRef: 'secret.openai'
  }
}

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mam-profile-registry-'))
  temporaryDirectories.push(root)
  return root
}
