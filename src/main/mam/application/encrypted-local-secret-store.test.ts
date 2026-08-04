import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EncryptedLocalSecretStore } from './encrypted-local-secret-store'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('EncryptedLocalSecretStore', () => {
  it('persists only encrypted values and resolves them by secret reference', () => {
    const root = mkdtempSync(join(tmpdir(), 'mam-secrets-'))
    temporaryDirectories.push(root)
    const path = join(root, 'secrets.enc.json')
    const store = new EncryptedLocalSecretStore(path, {
      encrypt: (value) => Buffer.from(`sealed:${value}`).reverse(),
      decrypt: (value) => value.reverse().toString().slice('sealed:'.length)
    })

    store.save('secret.relay', 'sk-local-test-value')

    expect(readFileSync(path, 'utf8')).not.toContain('sk-local-test-value')
    expect(
      store.resolve({
        id: 'secret.relay',
        secretRef: 'secret.relay',
        bindingIdentity: 'machine.test'
      })
    ).toBe('sk-local-test-value')
    expect(store.listConfigured()).toEqual(['secret.relay'])
  })
})
