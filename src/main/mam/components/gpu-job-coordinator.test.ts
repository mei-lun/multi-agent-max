import { test, expect } from 'vitest'
import { coordinateGpuHandler, gpuQueueStatus } from './gpu-job-coordinator'
import type { CreativeRequest } from '../../../shared/mam/creative-runtime'
import { CreativeJobManager } from '../creative-runtime'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const request = { params: {} } as CreativeRequest
const context = (signal = new AbortController().signal) => ({ signal, emit: async () => {} })
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
test('different services serialize native resource users while read-only status stays independent', async () => {
  const root = `gpu-test-${crypto.randomUUID()}`,
    gate = deferred(),
    started = deferred(),
    order: string[] = []
  const first = coordinateGpuHandler(root, 'music.generate', {
    validate() {},
    async run() {
      order.push('music')
      started.resolve()
      await gate.promise
    }
  })!
  const second = coordinateGpuHandler(root, 'model3d.start', {
    validate() {},
    async run() {
      order.push('3d')
    }
  })!
  const cpu = coordinateGpuHandler(root, 'music.status', {
    validate() {},
    async run() {
      order.push('cpu')
    }
  })!
  const a = first.run(request, context())
  await started.promise
  const b = second.run(request, context())
  await cpu.run(request, context())
  expect(order).toEqual(['music', 'cpu'])
  expect(gpuQueueStatus(root).waiting).toBe(1)
  gate.resolve()
  await Promise.all([a, b])
  expect(order).toEqual(['music', 'cpu', '3d'])
})
test('waiting cancellation never runs, running abort retains admission through delayed teardown', async () => {
  const root = `gpu-test-${crypto.randomUUID()}`,
    teardown = deferred(),
    started = deferred(),
    runningAbort = new AbortController(),
    waitingAbort = new AbortController()
  let secondRan = false
  const first = coordinateGpuHandler(root, 'spine.rife.frame', {
    validate() {},
    async run() {
      started.resolve()
      await teardown.promise
      throw new Error('aborted')
    }
  })!
  const second = coordinateGpuHandler(root, 'music.generate', {
    validate() {},
    async run() {
      secondRan = true
    }
  })!
  const a = first.run(request, context(runningAbort.signal)),
    failure = expect(a).rejects.toThrow('aborted')
  await started.promise
  const b = second.run(request, context(waitingAbort.signal))
  await Promise.resolve()
  const cancelled = expect(b).rejects.toThrow('cancelled')
  waitingAbort.abort()
  runningAbort.abort()
  await cancelled
  expect(secondRan).toBe(false)
  expect(gpuQueueStatus(root).running).toBe(true)
  teardown.resolve()
  await failure
  expect(gpuQueueStatus(root).running).toBe(false)
  await second.run(request, context())
  expect(secondRan).toBe(true)
})
test('already-coordinated fallback handlers are not wrapped twice', async () => {
  const root = `gpu-test-${crypto.randomUUID()}`
  const handler = coordinateGpuHandler(root, 'music.generate', {
    validate() {},
    async run() {
      return 'ok'
    }
  })!
  expect(coordinateGpuHandler(root, 'music.generate', handler)).toBe(handler)
  expect(await handler.run(request, context())).toBe('ok')
})
test('disposing a manager removes its waiting GPU job without releasing another manager slot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gpu-managers-')),
    gate = deferred(),
    started = deferred()
  let waitingRan = false
  const first = await CreativeJobManager.open({
    directory: join(root, 'first'),
    handlers: () =>
      coordinateGpuHandler(root, 'music.generate', {
        validate() {},
        async run() {
          started.resolve()
          await gate.promise
        }
      })
  })
  const second = await CreativeJobManager.open({
    directory: join(root, 'second'),
    handlers: () =>
      coordinateGpuHandler(root, 'model3d.start', {
        validate() {},
        async run() {
          waitingRan = true
        }
      })
  })
  const job = {
    componentId: 'creative.music',
    componentVersion: '1.0.0',
    projectId: 'p',
    operation: 'music.generate',
    params: {},
    inputAssets: [],
    idempotencyKey: 'one'
  }
  try {
    await first.submit(job)
    await started.promise
    await second.submit({ ...job, componentId: 'creative.model3d', operation: 'model3d.start' })
    for (let i = 0; i < 100 && gpuQueueStatus(root).waiting === 0; i++)
      await new Promise((resolve) => setTimeout(resolve, 2))
    expect(gpuQueueStatus(root).waiting).toBe(1)
    await second.dispose()
    expect(waitingRan).toBe(false)
    expect(gpuQueueStatus(root).running).toBe(true)
    gate.resolve()
    await first.dispose()
    expect(gpuQueueStatus(root).running).toBe(false)
  } finally {
    gate.resolve()
    await first.dispose()
    await second.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
