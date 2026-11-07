import { randomUUID } from 'node:crypto'
import { ipcMain, dialog, type BrowserWindow, type IpcMainEvent } from 'electron'
import {
  COMPONENT_CLOSE_ACK,
  COMPONENT_CLOSE_REQUEST
} from '../../../shared/mam/component-host-channel'

export function bindComponentCloseLifecycle(
  window: BrowserWindow,
  options: { timeoutMs?: number; onError?(message: string): void } = {}
) {
  let approved = false,
    pending: Promise<boolean> | undefined
  let current: { nonce: string; finish(allow: boolean): void } | undefined
  const report = (message: string) => {
    if (options.onError) options.onError(message)
    else if (!window.isDestroyed())
      void dialog.showMessageBox(window, {
        type: 'error',
        message,
        title: 'Component could not close'
      })
  }
  const ack = (event: IpcMainEvent, value: unknown) => {
    if (
      window.isDestroyed() ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      !event.senderFrame?.url.startsWith('mam-component://package/')
    )
      return
    if (!value || typeof value !== 'object') return
    const { nonce, allow } = value as { nonce?: unknown; allow?: unknown }
    if (typeof allow !== 'boolean' || nonce !== current?.nonce) return
    current?.finish(allow)
  }
  ipcMain.on(COMPONENT_CLOSE_ACK, ack)
  const requestClose = (): Promise<boolean> => {
    if (window.isDestroyed()) return Promise.resolve(true)
    if (pending) return pending
    const nonce = randomUUID()
    pending = new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        current?.finish(false)
        report(
          'Saving did not finish in time. The component remains open; save your work and try closing again.'
        )
      }, options.timeoutMs ?? 30000)
      current = {
        nonce,
        finish: (allow) => {
          clearTimeout(timeout)
          current = undefined
          if (allow && !window.isDestroyed()) {
            approved = true
            window.close()
          }
          resolve(allow)
        }
      }
      window.webContents.send(COMPONENT_CLOSE_REQUEST, nonce)
    }).finally(() => {
      pending = undefined
    })
    return pending
  }
  window.on('close', (event) => {
    if (!approved) {
      event.preventDefault()
      void requestClose()
    }
  })
  window.once('closed', () => {
    current?.finish(true)
    ipcMain.removeListener(COMPONENT_CLOSE_ACK, ack)
  })
  return { requestClose }
}
