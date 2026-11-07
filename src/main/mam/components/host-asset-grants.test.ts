import { test, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AssetGrants } from './host-asset-grants'
test('persisted grants bind exact reference to project and component', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'grants-'))
  try {
    const ref = {
      id: '12345678-1234-4234-8234-123456789abc',
      sha256: 'a'.repeat(64),
      bytes: 1,
      mime: 'image/png',
      filename: 'a.png'
    }
    const grants = new AssetGrants(root)
    await grants.grant('project', 'creative.image', ref)
    const restarted = new AssetGrants(root)
    expect(await restarted.has('project', 'creative.image', ref)).toBe(true)
    expect(await restarted.has('other', 'creative.image', ref)).toBe(false)
    expect(await restarted.has('project', 'creative.video', ref)).toBe(false)
    expect(restarted.contains({ assets: [ref] }, ref)).toBe(true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
