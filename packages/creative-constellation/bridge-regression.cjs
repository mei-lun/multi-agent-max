const { build } = require('esbuild'),
  vm = require('node:vm'),
  assert = require('node:assert/strict')
;(async () => {
  const compiled = await build({
    entryPoints: [__dirname + '/media-execution.ts'],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser'
  })
  const storage = new Map(),
    ref = (i) => ({
      id: 'asset-' + i,
      sha256: 'a'.repeat(64),
      bytes: 12,
      mime: 'image/png',
      filename: i + '.png'
    })
  let ready = false,
    submitted
  const request = async (r) => {
    if (r.action === 'listModels')
      return [{ id: 'profile', kind: 'image', operations: ['image.generate'] }]
    if (r.action === 'submit') {
      submitted = r
      return 'job'
    }
    if (r.action === 'listJobs') return [{ id: 'job', state: ready ? 'succeeded' : 'running' }]
    if (r.action === 'events')
      return ready
        ? [{ sequence: 1, type: 'succeeded', data: { assets: [ref(0), ref(1), ref(2)] } }]
        : []
    if (r.action === 'previewAsset') return 'preview:' + r.ref.id
    throw Error(r.action)
  }
  const load = () => {
    const sandbox = {
      module: { exports: {} },
      exports: {},
      window: { componentHost: { request } },
      localStorage: { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v) },
      setInterval: () => {},
      crypto: { randomUUID: () => 'id' },
      structuredClone
    }
    vm.runInNewContext(compiled.outputFiles[0].text, sandbox)
    return sandbox.module.exports
  }
  let api = load()
  const result = await api.submitExecution(
    { kind: 'image', profileId: 'profile', prompt: 'original prompt', count: 3, size: '1024x1024' },
    () => {}
  )
  assert.equal(submitted.params.prompt, 'original prompt')
  assert.equal(submitted.params.count, 3)
  assert.equal(result.assets.length, 3)
  assert.equal(new Set(result.assets.map((a) => a.id)).size, 3)
  ready = true
  api = load()
  for (let i = 0; i < 3; i++) {
    const asset = await api.refreshExecution(result.assets[i].id)
    assert.equal(asset.assetRef.id, 'asset-' + i)
  }
  assert.equal(JSON.parse(storage.get('mam.constellation.media-jobs')).length, 0)
  api = load()
  const restored = await api.refreshExecution(result.assets[2].id)
  assert.equal(restored.assetRef.id, 'asset-2')
  assert.equal(api.cachedMediaUrl(restored), 'preview:asset-2')
  console.log(
    'PASS indexed multi-output; original prompt/count; pending/completed reload; restored preview'
  )
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
