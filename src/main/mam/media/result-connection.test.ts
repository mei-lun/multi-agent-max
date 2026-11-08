import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { test, expect, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ status: 200, options: undefined as unknown, resolveCalls: 0 }))
vi.mock('node:dns/promises', () => ({
  lookup: async () => {
    fixture.resolveCalls++
    return [{ address: fixture.resolveCalls === 1 ? '8.8.8.8' : '127.0.0.1', family: 4 }]
  }
}))
vi.mock('node:https', () => ({
  request: (_url: URL, options: unknown, callback: (response: unknown) => void) => {
    fixture.options = options
    const req = new EventEmitter() as EventEmitter & { setTimeout: () => void; end: () => void }
    req.setTimeout = () => {}
    req.end = () => {
      const res = Readable.from([Buffer.from('fixture')]) as Readable & { statusCode: number }
      res.statusCode = fixture.status
      callback(res)
    }
    return req
  }
}))
import { downloadResult } from './result-download'

test('public resolution is pinned for connection and no provider headers are forwarded', async () => {
  fixture.resolveCalls = 0
  fixture.status = 200
  expect(
    (
      await downloadResult(new URL('https://public.example/image'), new AbortController().signal)
    ).toString()
  ).toBe('fixture')
  const options = fixture.options as {
    agent: boolean
    headers?: unknown
    lookup: (
      host: string,
      options: unknown,
      callback: (error: unknown, address: string, family: number) => void
    ) => void
  }
  expect(options.agent).toBe(false)
  expect(options.headers).toBeUndefined()
  options.lookup('public.example', {}, (_err, address, family) => {
    expect(address).toBe('8.8.8.8')
    expect(family).toBe(4)
  })
  expect(fixture.resolveCalls).toBe(1)
})
test('redirect responses fail without following destination', async () => {
  fixture.resolveCalls = 0
  fixture.status = 302
  await expect(
    downloadResult(new URL('https://public.example/image'), new AbortController().signal)
  ).rejects.toThrow('HTTP failure')
  expect(fixture.resolveCalls).toBe(1)
})
