import { expect, test, vi } from 'vitest'
vi.mock('electron', () => ({ dialog: {}, ipcMain: { handle: vi.fn() }, BrowserWindow: class {} }))
import { authorizeComponentSender } from './component-host-service'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { componentHostRequestSchema } from '../../../shared/mam/component-host-api'
test('only bound main frame of exact component window is authorized', () => {
  const frame = { url: 'mam-component://package/index.html' }
  const contents = { mainFrame: frame }
  const window = { isDestroyed: () => false, webContents: contents } as unknown as BrowserWindow
  const event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent
  expect(() => authorizeComponentSender(event, window)).not.toThrow()
  expect(() =>
    authorizeComponentSender({ ...event, sender: {} } as IpcMainInvokeEvent, window)
  ).toThrow('Untrusted')
  expect(() =>
    authorizeComponentSender(
      { ...event, senderFrame: { url: frame.url } } as IpcMainInvokeEvent,
      window
    )
  ).toThrow('Untrusted')
  frame.url = 'https://example.com'
  expect(() => authorizeComponentSender(event, window)).toThrow('Untrusted')
})
test('bridge rejects renderer paths and forged attempt/project context', () => {
  expect(
    componentHostRequestSchema.safeParse({ action: 'importAsset', path: '/secret' }).success
  ).toBe(false)
  const request = {
    action: 'submit',
    operation: 'render',
    idempotencyKey: 'k',
    params: {},
    inputAssets: []
  }
  expect(componentHostRequestSchema.safeParse(request).success).toBe(true)
  for (const extra of [
    { projectId: 'victim' },
    { attempt: { id: 'a', serverId: 's' } },
    { componentId: 'creative.video' }
  ])
    expect(componentHostRequestSchema.safeParse({ ...request, ...extra }).success).toBe(false)
})
