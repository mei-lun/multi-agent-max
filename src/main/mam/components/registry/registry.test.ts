import { afterEach, expect, test } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { ComponentRegistry } from './index'
import { relativePathSchema } from '../../../../shared/mam/components'
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'registry-'))
  roots.push(root)
  const sourceDirectory = path.join(root, 'source')
  await mkdir(sourceDirectory)
  const hash = createHash('sha256').update('content').digest('hex')
  const manifest = {
    id: 'creative.image',
    version: '1.0.0',
    hostApiVersion: '1.0.0',
    minimumHostVersion: '1.0.0',
    platforms: [{ os: 'win32', arch: 'x64' }],
    source: { commit: 'a'.repeat(40), sha256: hash },
    files: { 'entry.txt': hash },
    uiEntrypoint: 'entry.txt',
    runtimeEntrypoint: 'entry.txt',
    dependencies: [],
    resources: [],
    operations: [{ id: 'generate', title: 'Generate', description: '', requiredCapabilities: [] }]
  }
  await writeFile(path.join(sourceDirectory, 'manifest.json'), JSON.stringify(manifest))
  await writeFile(path.join(sourceDirectory, 'entry.txt'), 'content')
  const options = {
    root: path.join(root, 'registry'),
    hostVersion: '1.0.0',
    hostApiVersion: '1.0.0',
    platform: 'win32',
    arch: 'x64'
  }
  return { root, sourceDirectory, options, registry: new ComponentRegistry(options) }
}

test('missing installed content rejects restart without erasing durable inventory', async () => {
  const f = await fixture()
  await f.registry.install({ sourceDirectory: f.sourceDirectory, trustLocal: true })
  const registryPath = path.join(f.options.root, 'registry.json')
  const before = await readFile(registryPath, 'utf8')
  await rm(path.join(f.options.root, 'packages', 'creative.image', '1.0.0', 'entry.txt'))
  await expect(new ComponentRegistry(f.options).list()).rejects.toThrow()
  expect(await readFile(registryPath, 'utf8')).toBe(before)
})

test('package ancestor junction rejects publication outside private root', async () => {
  const f = await fixture()
  await f.registry.list()
  const outside = path.join(f.root, 'outside')
  await mkdir(outside)
  await symlink(outside, path.join(f.options.root, 'packages'), 'junction')
  await expect(
    f.registry.install({ sourceDirectory: f.sourceDirectory, trustLocal: true })
  ).rejects.toThrow('symlink')
})

test('acquiring dependent verifies transitive dependency bytes', async () => {
  const f = await fixture()
  await f.registry.install({ sourceDirectory: f.sourceDirectory, trustLocal: true })
  await f.registry.enable({ id: 'creative.image', version: '1.0.0' })
  const manifest = JSON.parse(await readFile(path.join(f.sourceDirectory, 'manifest.json'), 'utf8'))
  manifest.id = 'creative.video'
  manifest.dependencies = [{ id: 'creative.image', version: '1.0.0' }]
  await writeFile(path.join(f.sourceDirectory, 'manifest.json'), JSON.stringify(manifest))
  await f.registry.install({ sourceDirectory: f.sourceDirectory, trustLocal: true })
  await f.registry.enable({ id: 'creative.video', version: '1.0.0' })
  await writeFile(
    path.join(f.options.root, 'packages', 'creative.image', '1.0.0', 'entry.txt'),
    'tampered'
  )
  await expect(f.registry.acquire('creative.video')).rejects.toThrow('integrity')
})
test('install persists, leases protect versions, removal preserves user data', async () => {
  const f = await fixture()
  await f.registry.install({ sourceDirectory: f.sourceDirectory, trustLocal: true })
  await f.registry.enable({ id: 'creative.image', version: '1.0.0' })
  const lease = await f.registry.acquire('creative.image')
  await expect(f.registry.remove({ id: 'creative.image', version: '1.0.0' })).rejects.toThrow(
    'in use'
  )
  lease.release()
  const restarted = new ComponentRegistry(f.options)
  expect((await restarted.list())[0]!.versions).toHaveLength(1)
  await mkdir(path.join(f.options.root, 'data'))
  await writeFile(path.join(f.options.root, 'data', 'user.txt'), 'saved')
  await restarted.remove({ id: 'creative.image', version: '1.0.0' })
  expect(await readFile(path.join(f.options.root, 'data', 'user.txt'), 'utf8')).toBe('saved')
})
test('tampering, incompatible host and unsafe paths are rejected', async () => {
  const f = await fixture()
  await writeFile(path.join(f.sourceDirectory, 'entry.txt'), 'tampered')
  await expect(
    f.registry.install({ sourceDirectory: f.sourceDirectory, trustLocal: true })
  ).rejects.toThrow('hash mismatch')
  const incompatible = new ComponentRegistry({ ...f.options, hostVersion: '0.1.0' })
  await expect(
    incompatible.install({ sourceDirectory: f.sourceDirectory, trustLocal: true })
  ).rejects.toThrow('Incompatible')
  for (const unsafe of ['../x', '/x', 'a\\x', 'C:x', 'nul.txt'])
    expect(relativePathSchema.safeParse(unsafe).success).toBe(false)
})

test('returned manifests cannot mutate state and published orphans permit retry', async () => {
  const f = await fixture()
  const orphan = path.join(f.options.root, 'packages', 'creative.image', '1.0.0')
  await mkdir(orphan, { recursive: true })
  await writeFile(path.join(orphan, 'partial'), 'interrupted')
  const manifest = await f.registry.install({
    sourceDirectory: f.sourceDirectory,
    trustLocal: true
  })
  manifest.version = '9.0.0'
  const listed = await f.registry.list()
  listed[0]!.versions[0]!.manifest.version = '8.0.0'
  await f.registry.enable({ id: 'creative.image', version: '1.0.0' })
  const lease = await f.registry.acquire('creative.image')
  expect(lease.manifest.version).toBe('1.0.0')
  lease.release()
})

test('restart rejects corrupted active envelope and modified installed bytes', async () => {
  const f = await fixture()
  await f.registry.install({ sourceDirectory: f.sourceDirectory, trustLocal: true })
  const file = path.join(f.options.root, 'registry.json')
  const raw = JSON.parse(await readFile(file, 'utf8'))
  raw.schemaVersion = 99
  await writeFile(file, JSON.stringify(raw))
  await expect(new ComponentRegistry(f.options).list()).rejects.toThrow()
  raw.schemaVersion = 1
  raw.active = { 'creative.image': '9.0.0' }
  await writeFile(file, JSON.stringify(raw))
  await expect(new ComponentRegistry(f.options).list()).rejects.toThrow('active')
  raw.active = {}
  await writeFile(file, JSON.stringify(raw))
  await writeFile(
    path.join(f.options.root, 'packages', 'creative.image', '1.0.0', 'entry.txt'),
    'changed'
  )
  await expect(new ComponentRegistry(f.options).list()).rejects.toThrow('integrity')
})
