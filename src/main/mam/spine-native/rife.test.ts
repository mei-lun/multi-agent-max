import { test, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { BinaryAssetStore } from '../creative-runtime/assets'
import { rifeHandler } from './rife'
test('RIFE controlled real subprocess uses bounded args and owned PNGs, cleans temp files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rife-fixture-'))
  try {
    const assets = await BinaryAssetStore.open(join(directory, 'assets')),
      model = join(directory, 'rife-v4.6')
    await mkdir(model)
    for (const file of ['flownet.bin', 'flownet.param'])
      await writeFile(join(model, file), 'fixture')
    const script = join(directory, 'controlled.cjs')
    await writeFile(
      script,
      `const fs=require('node:fs');const args=process.argv.slice(2);const value=key=>args[args.indexOf(key)+1];if(value('-s')!=='0.5'||value('-g')!=='-1')process.exit(2);fs.copyFileSync(value('-0'),value('-o'));`
    )
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=',
      'base64'
    )
    const ref = await assets.import(
      (async function* () {
        yield png
      })(),
      { filename: 'frame.png', mime: 'image/png' }
    )
    const request = {
      componentId: 'c',
      componentVersion: '1',
      projectId: 'p',
      operation: 'spine.rife.frame',
      params: { fraction: 0.5, gpu: -1 },
      inputAssets: [ref, ref],
      idempotencyKey: 'k'
    }
    let working = ''
    const handler = rifeHandler(request, {
      assets,
      validateImage: () => 'image/png',
      config: { executable: process.execPath, modelDirectory: model },
      spawnProcess: (exe, args, options) => {
        working = String(args![1])
        return spawn(exe, [script, ...args!], options!)
      }
    })
    const result = (await handler.run(request, {
      signal: new AbortController().signal,
      emit: async () => {}
    })) as { assetRef: typeof ref }
    expect(await assets.read(result.assetRef)).toEqual(png)
    await expect(readdir(join(working, '..'))).rejects.toThrow()
    expect(() =>
      rifeHandler(
        { ...request, params: { fraction: 0, gpu: 0 } },
        {
          assets,
          validateImage: () => 'image/png',
          config: { executable: process.execPath, modelDirectory: model }
        }
      )
    ).toThrow()
    expect(() =>
      rifeHandler(
        { ...request, params: { fraction: 0.5, gpu: 0, executable: 'arbitrary' } },
        {
          assets,
          validateImage: () => 'image/png',
          config: { executable: process.execPath, modelDirectory: model }
        }
      )
    ).toThrow()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
