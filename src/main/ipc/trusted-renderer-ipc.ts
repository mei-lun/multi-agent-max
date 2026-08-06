import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'

export function assertTrustedRenderer(event: IpcMainInvokeEvent, window: BrowserWindow): void {
  if (window.isDestroyed() || event.sender !== window.webContents) {
    throw new Error('MAM IPC rejected an untrusted Renderer')
  }
  const frame = event.senderFrame
  if (!frame || frame !== window.webContents.mainFrame) {
    throw new Error('MAM IPC requires the main Renderer frame')
  }
}
