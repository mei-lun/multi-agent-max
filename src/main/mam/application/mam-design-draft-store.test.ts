import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MamDesignDraftStore } from './mam-design-draft-store'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('MAM Design Draft store', () => {
  it('persists the local draft as a private unencrypted JSON file', () => {
    const root = mkdtempSync(join(tmpdir(), 'mam-design-draft-'))
    temporaryDirectories.push(root)
    const path = join(root, 'design-draft.json')
    const store = new MamDesignDraftStore(path, () => '2026-07-29T12:00:00Z')
    const draft = store.reset('model.designer')

    expect(store.get()).toEqual(draft)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(draft)
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('archives malformed JSON and starts a fresh local draft', () => {
    const root = temporaryDirectory()
    const path = join(root, 'design-draft.json')
    writeFileSync(path, '{not valid json', { encoding: 'utf8', mode: 0o600 })
    const store = new MamDesignDraftStore(path, fixedNow)

    const draft = store.get()

    expect(draft).toMatchObject({
      schemaVersion: '1.0.0',
      messages: [],
      status: 'draft',
      createdAt: fixedNow(),
      updatedAt: fixedNow()
    })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(draft)
    expect(corruptDraftNames(root)).toEqual(['design-draft.corrupt-2026-07-29T12-00-00-000Z.json'])
    expect(readFileSync(join(root, corruptDraftNames(root)[0]!), 'utf8')).toBe('{not valid json')
    expect(statSync(join(root, corruptDraftNames(root)[0]!)).mode & 0o777).toBe(0o600)
  })

  it('archives a schema-invalid draft without overwriting an existing recovery copy', () => {
    const root = temporaryDirectory()
    const path = join(root, 'design-draft.json')
    const existingArchive = join(root, 'design-draft.corrupt-2026-07-29T12-00-00-000Z.json')
    writeFileSync(existingArchive, 'older corrupt draft', { encoding: 'utf8', mode: 0o600 })
    writeFileSync(path, JSON.stringify({ schemaVersion: '1.0.0', messages: [] }), {
      encoding: 'utf8',
      mode: 0o600
    })
    const store = new MamDesignDraftStore(path, fixedNow)

    const draft = store.get()

    expect(draft.status).toBe('draft')
    expect(readFileSync(existingArchive, 'utf8')).toBe('older corrupt draft')
    expect(corruptDraftNames(root)).toEqual([
      'design-draft.corrupt-2026-07-29T12-00-00-000Z.2.json',
      'design-draft.corrupt-2026-07-29T12-00-00-000Z.json'
    ])
  })
})

function temporaryDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), 'mam-design-draft-'))
  temporaryDirectories.push(root)
  return root
}

function corruptDraftNames(root: string): string[] {
  return readdirSync(root)
    .filter((name) => name.includes('.corrupt-'))
    .sort()
}

function fixedNow(): string {
  return '2026-07-29T12:00:00.000Z'
}
