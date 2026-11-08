import { test, expect } from 'vitest'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { runModelLauncher } from './launcher'
test.each([false, true])('real controlled launcher protocol failure=%s', async (failed) => {
  const data = await mkdtemp(join(tmpdir(), 'model-launch-')),
    script = join(data, 'fixture.cjs')
  try {
    await writeFile(
      script,
      `const fs=require('node:fs'),path=require('node:path');let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const request=JSON.parse(input);if(request.stage!=='shape'||!process.env.LEVELUP_3D_PARENT_PID)process.exit(3);fs.writeFileSync(path.join(${JSON.stringify(data)},'operation.json'),JSON.stringify({status:${JSON.stringify(failed ? 'failed' : 'completed')}}));process.exit(${failed ? 1 : 0})})`
    )
    const task = runModelLauncher({
      python: process.execPath,
      script: 'original-launcher.py',
      data,
      resources: join(data, 'resources'),
      version: '0.1.43',
      request: { projectId: 'a'.repeat(32), stage: 'shape' },
      signal: new AbortController().signal,
      emit: async () => {},
      spawnProcess: (exe, args, options) => {
        expect(args).toContain('--resources')
        expect(args.at(-1)).toBe('generate')
        return spawn(exe, [script], options)
      }
    })
    if (failed) await expect(task).rejects.toThrow('failed')
    else expect(await task).toEqual({ status: 'completed' })
    expect(JSON.parse(await readFile(join(data, 'operation.json'), 'utf8')).status).toBe(
      failed ? 'failed' : 'completed'
    )
  } finally {
    await rm(data, { recursive: true, force: true })
  }
})
test('cancellation writes original cancel marker and waits launcher exit', async () => {
  const data = await mkdtemp(join(tmpdir(), 'model-cancel-')),
    script = join(data, 'fixture.cjs'),
    controller = new AbortController()
  try {
    await writeFile(
      script,
      `const fs=require('node:fs');setInterval(()=>{if(fs.existsSync(${JSON.stringify(join(data, 'cancel'))}))process.exit(0)},10);process.stdin.resume()`
    )
    const task = runModelLauncher({
      python: process.execPath,
      script: 'launcher.py',
      data,
      resources: data,
      version: '0.1.43',
      request: {},
      signal: controller.signal,
      emit: async () => {},
      spawnProcess: (exe, _args, options) => {
        setTimeout(() => controller.abort(), 100)
        return spawn(exe, [script], options)
      }
    })
    await expect(task).rejects.toThrow()
    expect(await readFile(join(data, 'cancel'), 'utf8')).toBe('cancel')
  } finally {
    await rm(data, { recursive: true, force: true })
  }
})
