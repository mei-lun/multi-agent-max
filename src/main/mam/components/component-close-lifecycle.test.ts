import { EventEmitter } from 'node:events'
import { test, expect, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ on: vi.fn(), removeListener: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: mocks, dialog: { showMessageBox: vi.fn() } }))
import type { BrowserWindow, IpcMainEvent } from 'electron'
import { bindComponentCloseLifecycle } from './component-close-lifecycle'
function fixture() {
  const window = new EventEmitter() as EventEmitter & {
    webContents: { mainFrame: { url: string }; send: ReturnType<typeof vi.fn> }
    isDestroyed(): boolean
    close(): void
  }
  let destroyed = false
  window.webContents = { mainFrame: { url: 'mam-component://package/index.html' }, send: vi.fn() }
  window.isDestroyed = () => destroyed
  window.close = () => {
    let prevented = false
    window.emit('close', {
      preventDefault() {
        prevented = true
      }
    })
    if (!prevented) {
      destroyed = true
      window.emit('closed')
    }
  }
  const error = vi.fn(),
    lifecycle = bindComponentCloseLifecycle(window as unknown as BrowserWindow, {
      timeoutMs: 100,
      onError: error
    })
  const ack = mocks.on.mock.calls.at(-1)![1] as (event: IpcMainEvent, value: unknown) => void
  const acknowledge = (
    allow: boolean,
    nonce = window.webContents.send.mock.calls.at(-1)![1],
    sender = window.webContents
  ) =>
    ack({ sender, senderFrame: window.webContents.mainFrame } as unknown as IpcMainEvent, {
      nonce,
      allow
    })
  return { window, lifecycle, error, acknowledge }
}
test('close coalesces and waits for async save ack; stale/foreign ack cannot close it', async () => {
  const f = fixture(),
    first = f.lifecycle.requestClose(),
    second = f.lifecycle.requestClose()
  expect(first).toBe(second)
  expect(f.window.isDestroyed()).toBe(false)
  f.acknowledge(true, 'stale')
  expect(f.window.isDestroyed()).toBe(false)
  f.acknowledge(true, undefined, {} as never)
  expect(f.window.isDestroyed()).toBe(false)
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(f.window.isDestroyed()).toBe(false)
  f.acknowledge(true)
  expect(await first).toBe(true)
  expect(f.window.isDestroyed()).toBe(true)
})
test('veto keeps window and allows a later close; timeout also fails closed', async () => {
  const f = fixture(),
    first = f.lifecycle.requestClose()
  f.acknowledge(false)
  expect(await first).toBe(false)
  expect(f.window.isDestroyed()).toBe(false)
  const second = f.lifecycle.requestClose()
  expect(await second).toBe(false)
  expect(f.error).toHaveBeenCalledOnce()
  expect(f.window.isDestroyed()).toBe(false)
  const third = f.lifecycle.requestClose()
  f.acknowledge(true)
  expect(await third).toBe(true)
})
