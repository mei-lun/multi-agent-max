import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MamLocalSettingsStore } from './mam-local-settings-store'
import { defaultMamLocalSettings } from '../../../shared/mam/local-settings'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('local log directory setting', () => {
  it('shows the actual default for new and existing settings, and persists a custom absolute path', () => {
    const root = mkdtempSync(join(tmpdir(), 'mam-log-setting-'))
    roots.push(root)
    const path = join(root, 'local-settings.json')
    const store = new MamLocalSettingsStore(path)
    expect(store.get().logDirectory).toBe(join(root, 'diagnostics'))
    writeFileSync(path, JSON.stringify(defaultMamLocalSettings()))
    expect(store.get().logDirectory).toBe(join(root, 'diagnostics'))
    const directory = join(root, 'custom logs', '日志')
    store.save({ ...store.get(), logDirectory: directory })
    expect(existsSync(directory)).toBe(true)
    expect(new MamLocalSettingsStore(path).get().logDirectory).toBe(directory)
  })

  it('rejects relative, blank, and non-directory destinations without overwriting the saved setting', () => {
    const root = mkdtempSync(join(tmpdir(), 'mam-log-setting-'))
    roots.push(root)
    const path = join(root, 'local-settings.json')
    const store = new MamLocalSettingsStore(path)
    store.save(store.get())
    const before = readFileSync(path, 'utf8')
    const file = join(root, 'existing-file')
    writeFileSync(file, 'keep')
    for (const directory of ['relative/logs', ' ', file]) {
      expect(() => store.save({ ...store.get(), logDirectory: directory })).toThrow()
      expect(readFileSync(path, 'utf8')).toBe(before)
    }
  })
})
