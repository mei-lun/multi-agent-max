import { expect, test } from 'vitest'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { PackageProcess } from './package-process'

for (const crash of [false, true])
  test(`native heartbeat stops before ${crash ? 'crash' : 'forced cancellation'} releases invocation`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'package-tree-')),
      heartbeat = join(root, 'heartbeat')
    let worker: PackageProcess | undefined
    let descendant = 0
    try {
      const program = `require('node:fs').appendFileSync(${JSON.stringify(heartbeat)},'.');setInterval(()=>require('node:fs').appendFileSync(${JSON.stringify(heartbeat)},'.'),20)`
      const entry = join(root, 'worker.cjs')
      const adapter = join(root, 'native.cjs')
      await build({
        entryPoints: [resolve('packages/runtime/native-process.ts')],
        outfile: adapter,
        bundle: true,
        platform: 'node',
        format: 'cjs'
      })
      await writeFile(
        entry,
        `const {spawn}=require(${JSON.stringify(adapter)});process.on('message',m=>{if(m.type!=='run')return;const p=spawn(process.execPath,['-e',${JSON.stringify(program)}],{stdio:'ignore',windowsHide:true});setTimeout(()=>{process.send({type:'rpc',id:m.id,call:'ready',method:'ready',value:p.pid});${crash ? 'setTimeout(()=>process.exit(4),100)' : ''}},150)});`
      )
      worker = new PackageProcess(entry, 100)
      const controller = new AbortController()
      const result = worker.invoke({}, controller.signal, async (_method, value) => {
        descendant = Number(value)
        expect((await readFile(heartbeat, 'utf8')).length).toBeGreaterThan(0)
        if (!crash) controller.abort()
        return null
      })
      await expect(result).rejects.toMatchObject({ code: 'creative_reconciliation_required' })
      expect(descendant).toBeGreaterThan(0)
      const stopped = await readFile(heartbeat, 'utf8')
      await new Promise((resolve) => setTimeout(resolve, 150))
      expect(await readFile(heartbeat, 'utf8')).toBe(stopped)
      if (process.platform === 'win32') expect(() => process.kill(descendant, 0)).toThrow()
    } finally {
      await worker?.dispose()
      if (descendant)
        try {
          process.kill(descendant, 'SIGKILL')
        } catch {
          /* Already stopped. */
        }
      await rm(root, { recursive: true, force: true })
    }
  }, 15000)
