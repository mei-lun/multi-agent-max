import { test, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { installComponentQuitGuard } from './component-app-quit'
test('quit retries cannot bypass pending save; veto retains jobs and ownership lock', async () => {
  const app = Object.assign(new EventEmitter(), { quit: vi.fn() })
  let decision!: (allow: boolean) => void
  const closeAll = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          decision = resolve
        })
    ),
    cleanup = vi.fn(async () => {}),
    release = vi.fn(async () => {}),
    report = vi.fn()
  installComponentQuitGuard({ app, closeAll, cleanup, release, report })
  const first = { preventDefault: vi.fn() },
    second = { preventDefault: vi.fn() }
  app.emit('before-quit', first)
  app.emit('before-quit', second)
  expect(first.preventDefault).toHaveBeenCalledOnce()
  expect(second.preventDefault).toHaveBeenCalledOnce()
  expect(closeAll).toHaveBeenCalledOnce()
  decision(false)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(cleanup).not.toHaveBeenCalled()
  expect(release).not.toHaveBeenCalled()
  expect(app.quit).not.toHaveBeenCalled()
  app.emit('before-quit', { preventDefault: vi.fn() })
  decision(true)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(cleanup).toHaveBeenCalledOnce()
  expect(release).toHaveBeenCalledOnce()
  expect(app.quit).toHaveBeenCalledOnce()
  const final = { preventDefault: vi.fn() }
  app.emit('before-quit', final)
  expect(final.preventDefault).not.toHaveBeenCalled()
})
test('rejected handshake is reported without releasing the lock', async () => {
  const app = Object.assign(new EventEmitter(), { quit: vi.fn() }),
    release = vi.fn(async () => {}),
    report = vi.fn()
  installComponentQuitGuard({
    app,
    closeAll: async () => {
      throw new Error('save')
    },
    cleanup: async () => {},
    release,
    report
  })
  app.emit('before-quit', { preventDefault() {} })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(report).toHaveBeenCalledOnce()
  expect(release).not.toHaveBeenCalled()
  expect(app.quit).not.toHaveBeenCalled()
})
