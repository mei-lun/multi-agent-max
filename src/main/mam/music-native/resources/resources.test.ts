import { test, expect } from 'vitest'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createMusicResourceManager } from './index'
import { musicResourceSpecs, manifestName } from './specs'
import { extractMusicZip } from './zip'
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
function zip(name: string, data = Buffer.from('fixture'), mode = 0x81a4) {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  crc = (crc ^ 0xffffffff) >>> 0
  const filename = Buffer.from(name),
    local = Buffer.alloc(30),
    central = Buffer.alloc(46),
    end = Buffer.alloc(22)
  local.writeUInt32LE(0x04034b50)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(filename.length, 26)
  central.writeUInt32LE(0x02014b50)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(filename.length, 28)
  central.writeUInt32LE((mode * 65536) >>> 0, 38)
  const content = Buffer.concat([local, filename, data]),
    directory = Buffer.concat([central, filename])
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(content.length, 16)
  return Buffer.concat([content, directory, end])
}
test('online resumable verified install offline import pins and scoped removal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'music-resource-')),
    offline = join(root, 'offline')
  await mkdir(offline)
  const spec = musicResourceSpecs.musicgen,
    archives = { runtime: zip('python.exe'), 'musicgen-small': zip('model.safetensors') }
  const components: Record<string, unknown> = {},
    assets = new Map<string, Buffer>()
  for (const [name, archive] of Object.entries(archives)) {
    const part = `music-workbench-${spec.resourceVersion}-${spec.target}-${name}.zip.part001`
    components[name] = {
      unpackedBytes: 100,
      sha256: hash(archive),
      license: 'fixture',
      sources: ['fixture'],
      parts: [{ name: part, bytes: archive.length, sha256: hash(archive) }]
    }
    assets.set(part, archive)
    await writeFile(join(offline, part), archive)
  }
  const manifest = Buffer.from(JSON.stringify({ ...spec, components }))
  assets.set(manifestName(spec), manifest)
  await writeFile(join(offline, manifestName(spec)), manifest)
  let resumed = false
  const server = createServer((req, res) => {
    const bytes = assets.get(req.url!.slice(1))
    if (!bytes) {
      res.statusCode = 404
      return res.end()
    }
    const offset = Number(req.headers.range?.match(/bytes=(\d+)-/)?.[1] ?? 0)
    if (offset) {
      resumed = true
      res.statusCode = 206
      res.setHeader('content-range', `bytes ${offset}-${bytes.length - 1}/${bytes.length}`)
    }
    res.end(bytes.subarray(offset))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const manager = createMusicResourceManager({
    verifyReady: async () => {},
    root: join(root, 'managed'),
    assetUrl: (_spec, name) =>
      `http://127.0.0.1:${(server.address() as { port: number }).port}/${name}`
  })
  try {
    const first = [...assets].find(([name]) => name.endsWith('part001'))!
    const cache = join(root, 'managed', '.resource-downloads', spec.resourceVersion)
    await mkdir(cache, { recursive: true })
    await writeFile(join(cache, first[0]), first[1].subarray(0, 20))
    expect((await manager.install('musicgen')).installed).toBe(true)
    expect(resumed).toBe(true)
    const release = manager.pin('musicgen')
    await expect(manager.remove('musicgen')).rejects.toThrow('use')
    release()
    await mkdir(join(root, 'managed', 'outputs'))
    await writeFile(join(root, 'managed', 'outputs', 'keep'), 'keep')
    await manager.remove('musicgen')
    expect(await readFile(join(root, 'managed', 'outputs', 'keep'), 'utf8')).toBe('keep')
    expect((await manager.offline('musicgen', offline)).installed).toBe(true)
    await manager.remove('musicgen')
    await writeFile(join(offline, first[0]), 'corrupt')
    await expect(manager.offline('musicgen', offline)).rejects.toThrow()
    expect((await manager.status('musicgen')).installed).toBe(false)
    const controller = new AbortController()
    controller.abort()
    await expect(manager.install('musicgen', { signal: controller.signal })).rejects.toThrow()
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  }
})
test.each([
  ['../escape', 0x81a4],
  ['link', 0xa1ff],
  ['C:/escape', 0x81a4]
])('ZIP rejects unsafe path or symlink %s', async (name, mode) => {
  const root = await mkdtemp(join(tmpdir(), 'music-zip-'))
  try {
    const file = join(root, 'bad.zip')
    await writeFile(file, zip(String(name), undefined, Number(mode)))
    await mkdir(join(root, 'out'))
    await expect(
      extractMusicZip(file, join(root, 'out'), 100, new AbortController().signal)
    ).rejects.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('ZIP verifies CRC and expanded byte budgets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'music-crc-'))
  try {
    const file = join(root, 'bad.zip'),
      bytes = zip('file')
    bytes[34] = bytes[34]! ^ 1
    await writeFile(file, bytes)
    await mkdir(join(root, 'out'))
    await expect(
      extractMusicZip(file, join(root, 'out'), 100, new AbortController().signal)
    ).rejects.toThrow('checksum')
    await writeFile(file, zip('other'))
    await expect(
      extractMusicZip(file, join(root, 'out'), 1, new AbortController().signal)
    ).rejects.toThrow('budget')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
