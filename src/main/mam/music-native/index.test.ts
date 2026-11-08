import { test, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn, type SpawnOptions } from 'node:child_process'
import { createMusicNativeServices } from './index'
import { BinaryAssetStore } from '../creative-runtime/assets'
import { createHash } from 'node:crypto'

test('no runtime reports unavailable without pretending history is empty', async () => {
  const service = createMusicNativeServices({
    root: '.',
    modulesPath: '.',
    installedEngineRoots: {}
  })
  expect(await service.request('status')).toMatchObject({ ready: false, historyAvailable: false })
  await expect(service.request('generate')).rejects.toThrow('not installed')
  await service.dispose()
})

test('cancelling a task during a shared status read preserves the other native job', async () => {
  const root = await mkdtemp(join(tmpdir(), 'music-two-jobs-'))
  await mkdir(join(root, 'runtime', 'bin'), { recursive: true })
  await writeFile(
    join(root, 'runtime', process.platform === 'win32' ? 'python.exe' : 'bin/python'),
    ''
  )
  await writeFile(join(root, 'bridge.py'), '')
  const id = 'b'.repeat(32),
    wav = Buffer.from('RIFF0000WAVEdata')
  await mkdir(join(root, 'outputs', id), { recursive: true })
  await writeFile(join(root, 'outputs', id, 'audio.wav'), wav)
  const script = join(root, 'fixture.cjs')
  await writeFile(
    script,
    `const jobs=[];require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);let result;if(r.action==='generate'){result={id:(jobs.length?'b':'a').repeat(32),status:'running'};jobs.push(result)}else if(r.action==='cancel'){jobs.find(j=>j.id===r.request.id).status='cancelled';result=true}else{if(jobs[0]?.status==='cancelled'&&jobs[1]){jobs[1].status='succeeded';jobs[1].sha256='${createHash('sha256').update(wav).digest('hex')}'}result={jobs}}setTimeout(()=>console.log(JSON.stringify({result})),r.action==='status'?60:1)})`
  )
  const assets = await BinaryAssetStore.open(join(root, 'assets'))
  const service = createMusicNativeServices({
    root,
    modulesPath: root,
    assets,
    pollMs: 1,
    installedEngineRoots: { musicgen: root },
    spawn: ((_c: string, _a: string[], o: SpawnOptions) =>
      spawn(process.execPath, [script], o)) as unknown as typeof spawn
  })
  const controller = new AbortController()
  const job = {
    componentId: 'creative.music',
    componentVersion: '1',
    projectId: 'p',
    operation: 'music.generate',
    idempotencyKey: 'one',
    params: {},
    inputAssets: []
  }
  try {
    const first = service.handlers(job)!.run(job, {
      signal: controller.signal,
      emit: async () => {
        setTimeout(() => controller.abort(), 20)
      }
    })
    const rejected = expect(first).rejects.toThrow()
    const second = service
      .handlers({ ...job, idempotencyKey: 'two' })!
      .run(job, { signal: new AbortController().signal, emit: async () => {} })
    await rejected
    expect(await second).toHaveProperty('assets')
    const status = await service.request('status')
    expect(status).toMatchObject({ jobs: [{ status: 'cancelled' }, { status: 'succeeded' }] })
  } finally {
    await service.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

test('curated worker channel serializes requests and freezes queued parameters', async () => {
  const root = await mkdtemp(join(tmpdir(), 'music-worker-'))
  await mkdir(join(root, 'runtime', 'bin'), { recursive: true })
  await writeFile(
    join(root, 'runtime', process.platform === 'win32' ? 'python.exe' : 'bin/python'),
    ''
  )
  await writeFile(join(root, 'bridge.py'), '')
  const script = join(root, 'fixture.cjs')
  await writeFile(
    script,
    `require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);setTimeout(()=>console.log(JSON.stringify({result:r.request})),10)})`
  )
  const service = createMusicNativeServices({
    root,
    modulesPath: root,
    installedEngineRoots: { musicgen: root },
    spawn: ((_command: string, _args: string[], options: SpawnOptions) =>
      spawn(process.execPath, [script], options)) as unknown as typeof spawn
  })
  try {
    const first = service.request('status', { order: 1 })
    const params = { order: 2 }
    const second = service.request('status', params)
    params.order = 3
    expect(await first).toEqual({ order: 1 })
    expect(await second).toEqual({ order: 2 })
    await expect(service.request('arbitrary', { path: 'secret' })).rejects.toThrow('Unsupported')
  } finally {
    await service.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
