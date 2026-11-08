import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'

export function authorizeComponentSender(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  window: BrowserWindow
) {
  if (
    window.isDestroyed() ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    !event.senderFrame?.url.startsWith('mam-component://package/')
  )
    throw new Error('Untrusted component sender')
}
