import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prunePiRpcLogs } from './log-retention'
import { PiRpcLogWriter } from '../executors/pi-rpc-log-writer'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('24-hour RPC log retention', () => {
  it('prunes records within active invocations and old inactive logs without removing execution files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mam-log-retention-'))
    directories.push(root)
    const invocation = join(root, 'invocations', 'a'.repeat(64))
    mkdirSync(invocation, { recursive: true })
    const path = join(invocation, 'rpc.jsonl')
    const config = join(invocation, 'manifest.json')
    writeFileSync(config, '{"keep":true}')
    let now = '2026-09-13T12:00:00.000Z'
    const writer = new PiRpcLogWriter(path, [], () => now)
    await writer.append('event', { type: 'old' })
    now = '2026-09-14T11:59:00.000Z'
    await writer.append('event', { type: 'recent' })
    now = '2026-09-14T12:00:00.000Z'
    const writing = writer.append('stderr', 'last error')
    prunePiRpcLogs([root], Date.parse(now))
    await writing
    await writer.flush()
    const content = readFileSync(path, 'utf8')
    expect(content).not.toContain('old')
    expect(content).toContain('recent')
    expect(content).toContain('last error')
    prunePiRpcLogs([root], Date.parse('2026-09-15T12:00:00.000Z'))
    expect(existsSync(path)).toBe(false)
    expect(readFileSync(config, 'utf8')).toBe('{"keep":true}')
  })
})
