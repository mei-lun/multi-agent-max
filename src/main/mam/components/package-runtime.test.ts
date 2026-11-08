import { afterEach, expect, test, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { ComponentRegistry } from './registry'
import { BinaryAssetStore } from '../creative-runtime/assets'
import { RifeSettings } from './host-rife-settings'
import { createPackageRuntime } from './package-runtime'
import type { CreativeRequest } from '../../../shared/mam/creative-runtime'

vi.mock('electron', () => ({ dialog: {}, nativeImage: {} }))
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const worker = (version: string) => `
const calls = new Map();
process.on('message', message => {
 if (message.type === 'dispose') return process.exit(0);
 if (message.type === 'cancel') { clearTimeout(calls.get(message.id)); return process.send({type:'result',id:message.id,error:'cancelled'}); }
 if (message.type !== 'run') return;
 if(message.value.request.params.crash) return process.exit(4);
 calls.set(message.id,setTimeout(()=>process.send({type:'result',id:message.id,value:${JSON.stringify(version)}}),message.value.request.params.delay||0));
});`
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'package-runtime-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const registry = new ComponentRegistry({
    root: join(root, 'registry'),
    hostVersion: '1.0.0',
    hostApiVersion: '2.0.0'
  })
  const runtime = createPackageRuntime({
    root,
    registry,
    assets: await BinaryAssetStore.open(join(root, 'assets')),
    rifeSettings: new RifeSettings(join(root, 'rife'))
  })
  cleanups.push(() => runtime.dispose())
  const handlers = runtime.runtimeHandlers({
    catalog: {
      models: { listActive: () => [], getActive: () => undefined },
      providers: { getActive: () => undefined }
    },
    resolveSecret: () => undefined
  })
  const install = async (version: string, code = worker(version)) => {
    const directory = join(root, version)
    await mkdir(directory)
    const hash = createHash('sha256').update(code).digest('hex')
    await writeFile(join(directory, 'backend.cjs'), code)
    await writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify({
        id: 'creative.image',
        version,
        hostApiVersion: '2.0.0',
        minimumHostVersion: '1.0.0',
        platforms: [{ os: process.platform, arch: process.arch }],
        source: { commit: 'a'.repeat(40), sha256: hash },
        files: { 'backend.cjs': hash },
        uiEntrypoint: 'backend.cjs',
        runtimeEntrypoint: 'backend.cjs',
        dependencies: [],
        resources: [],
        operations: [
          { id: 'image.generate', title: 'Generate', description: '', requiredCapabilities: [] }
        ]
      })
    )
    await registry.install({ sourceDirectory: directory, trustLocal: true })
    await registry.enable({ id: 'creative.image', version })
  }
  const run = (version: string, params = {}, signal = new AbortController().signal) => {
    const request: CreativeRequest = {
      componentId: 'creative.image',
      componentVersion: version,
      operation: 'image.generate',
      projectId: 'test',
      idempotencyKey: 'test',
      inputAssets: [],
      params
    }
    return handlers(request)!.run(request, { signal, emit: async () => {} })
  }
  return { root, registry, runtime, install, run }
}
test('same host executes independently upgraded backend while an old invocation remains pinned', async () => {
  const f = await fixture()
  await f.install('1.0.0')
  const old = f.run('1.0.0', { delay: 400 })
  await f.install('1.0.1')
  await expect(f.run('1.0.1')).resolves.toBe('1.0.1')
  await expect(old).resolves.toBe('1.0.0')
  await expect(f.run('1.0.0')).resolves.toBe('1.0.0')
})
test('tampering after a process started is rejected before reusing it', async () => {
  const f = await fixture()
  await f.install('1.0.0')
  await f.run('1.0.0')
  await writeFile(
    join(f.root, 'registry/packages/creative.image/1.0.0/backend.cjs'),
    worker('tampered')
  )
  await expect(f.run('1.0.0')).rejects.toThrow(/hash|integrity/i)
})
test('cancel reaches the child and shutdown rejects subsequent work', async () => {
  const f = await fixture()
  await f.install('1.0.0')
  const controller = new AbortController()
  const result = f.run('1.0.0', { delay: 30000 }, controller.signal)
  const assertion = expect(result).rejects.toThrow(/cancel|abort/i)
  setTimeout(() => controller.abort(), 100)
  await assertion
  await f.runtime.dispose()
  await expect(f.run('1.0.0')).rejects.toThrow('disposed')
})
test('crashed process requires reconciliation and a new invocation starts a new process', async () => {
  const f = await fixture()
  await f.install('1.0.0')
  await expect(f.run('1.0.0', { crash: true })).rejects.toMatchObject({
    code: 'creative_reconciliation_required'
  })
  await expect(f.run('1.0.0')).resolves.toBe('1.0.0')
})
