import { test, expect, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { model3dResources, validateModel3dManifest, manifestFile, names } from './resources'
import { model3dResourceSpec } from '../../../shared/mam/model3d-native'
import type * as FsPromises from 'node:fs/promises'
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof FsPromises>()
  return {
    ...fs,
    writeFile: (...args: Parameters<typeof fs.writeFile>) => {
      // Inject failure for any truncating publication; atomic temporary writes work.
      if (String(args[0]).replaceAll('\\', '/').endsWith('/manifest.json'))
        throw new Error('Injected unsafe manifest write failure')
      return fs.writeFile(...args)
    }
  }
})
function archive() {
  const data = Buffer.from('fixture'),
    name = Buffer.from('model_index.json')
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  crc = (crc ^ 0xffffffff) >>> 0
  const local = Buffer.alloc(30),
    central = Buffer.alloc(46),
    end = Buffer.alloc(22)
  local.writeUInt32LE(0x04034b50)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(name.length, 26)
  central.writeUInt32LE(0x02014b50)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(name.length, 28)
  const content = Buffer.concat([local, name, data]),
    dir = Buffer.concat([central, name])
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(dir.length, 12)
  end.writeUInt32LE(content.length, 16)
  return Buffer.concat([content, dir, end])
}
test('tiny verified resource ZIP staging and manifest rejects mismatched target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'model-resources-')),
    offline = join(root, 'offline')
  await mkdir(offline)
  const bytes = archive(),
    digest = createHash('sha256').update(bytes).digest('hex'),
    components: Record<string, unknown> = {}
  for (const name of names) {
    const part = `model-workbench-2026.10.15-windows-x64-cu118-${name}.zip.part001`
    components[name] = {
      unpackedBytes: 7,
      sha256: digest,
      license: 'fixture',
      sources: ['fixture'],
      parts: [{ name: part, bytes: bytes.length, sha256: digest }]
    }
    await writeFile(join(offline, part), bytes)
  }
  const metadata = { ...model3dResourceSpec, components }
  await writeFile(join(offline, manifestFile), JSON.stringify(metadata))
  try {
    expect(() =>
      validateModel3dManifest(Buffer.from(JSON.stringify({ ...metadata, target: 'foreign' })))
    ).toThrow()
    const service = model3dResources(root)
    // Tiny fixtures prove extraction/registration, not real runtime readiness.
    const result = await service.install(
      ['triposg'],
      new AbortController().signal,
      async () => {},
      offline
    )
    expect(result.triposg).toBe(true)
    await writeFile(
      join(offline, `model-workbench-2026.10.15-windows-x64-cu118-texture.zip.part001`),
      'corrupt'
    )
    await expect(
      service.install(['texture'], new AbortController().signal, async () => {}, offline)
    ).rejects.toThrow()
    await rm(service.directory, { recursive: true, force: true })
    await expect(
      service.install(['triposg', 'texture'], new AbortController().signal, async () => {}, offline)
    ).rejects.toThrow()
    expect((await service.installed()).triposg).toBe(true)
    // An older texture remains usable if a refreshed manifest changes its hash,
    // but its replacement fails after the triposg commit.
    const texture = join(service.directory, 'texture')
    await mkdir(join(texture, 'base'), { recursive: true })
    await mkdir(join(texture, 'adapter'), { recursive: true })
    await writeFile(join(texture, 'base/model_index.json'), '{}')
    await writeFile(join(texture, 'adapter/mvadapter_ig2mv_sd21.safetensors'), 'old')
    await writeFile(join(texture, 'provenance.json'), '{}')
    await writeFile(
      join(texture, '.installed.json'),
      JSON.stringify({
        ...model3dResourceSpec,
        sha256: digest
      })
    )
    expect((await service.installed()).texture).toBe(true)
    const refreshed = structuredClone(metadata)
    ;(refreshed.components.texture as { sha256: string }).sha256 = 'a'.repeat(64)
    await writeFile(join(offline, manifestFile), JSON.stringify(refreshed))
    await expect(
      service.install(['triposg', 'texture'], new AbortController().signal, async () => {}, offline)
    ).rejects.toThrow()
    expect(await service.installed()).toMatchObject({ triposg: true, texture: true })
    await service.install(['triposg'], new AbortController().signal, async () => {}, offline)
    expect((await service.installed()).texture).toBe(true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
