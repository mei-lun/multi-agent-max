import { isAbsolute, join } from 'node:path'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { MamLocalSettingsStore } from './mam-local-settings-store'
import { ProfileCatalog } from './profile-catalog'
import { BUILTIN_PI_EXECUTOR_ID, ensureBuiltinPiProfile } from './builtin-pi-profile'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('built-in Pi profile', () => {
  it('registers Pi and creates a usable machine-local binding', () => {
    const root = mkdtempSync(join(tmpdir(), 'mam-builtin-pi-'))
    temporaryDirectories.push(root)
    const catalog = new ProfileCatalog(join(root, 'catalog'))
    const settings = new MamLocalSettingsStore(join(root, 'settings.json'), 'machine.test')
    const configRoot = join(root, 'pi-config')

    ensureBuiltinPiProfile(catalog, settings, configRoot)

    expect(catalog.executors.getActive(BUILTIN_PI_EXECUTOR_ID)).toMatchObject({
      kind: 'pi-rpc',
      adapterOptions: { mode: 'rpc' }
    })
    const binding = settings.get().executorBindings[0]
    expect(binding?.executorProfileId).toBe(BUILTIN_PI_EXECUTOR_ID)
    expect(binding?.configRoot).toBe(configRoot)
    expect(isAbsolute(binding?.executablePath ?? '')).toBe(true)
  })

  it('repairs a stale built-in binding after switching to development', () => {
    const root = mkdtempSync(join(tmpdir(), 'mam-builtin-pi-stale-'))
    temporaryDirectories.push(root)
    const catalog = new ProfileCatalog(join(root, 'catalog'))
    const settings = new MamLocalSettingsStore(join(root, 'settings.json'), 'machine.test')
    const configRoot = join(root, 'pi-config')
    const stalePath = join(root, 'missing-installed-app', 'cli.js')
    settings.save({
      ...settings.get(),
      executorBindings: [
        {
          id: 'binding.executor.pi',
          executorProfileId: BUILTIN_PI_EXECUTOR_ID,
          executablePath: stalePath,
          configRoot: join(root, 'old-config'),
          bindingIdentity: 'machine.test'
        }
      ]
    })

    ensureBuiltinPiProfile(catalog, settings, configRoot)

    const binding = settings.get().executorBindings[0]!
    expect(binding.id).toBe('binding.executor.pi')
    expect(binding.executablePath).not.toBe(stalePath)
    expect(existsSync(binding.executablePath)).toBe(true)
    expect(binding.configRoot).toBe(configRoot)
  })
})
