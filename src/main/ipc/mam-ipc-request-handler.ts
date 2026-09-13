import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { DesktopRuntimeLogger } from '../mam/diagnostics/desktop-runtime-logger'

export function mamIpcRequestHandler(runtimeLogger?: DesktopRuntimeLogger) {
  return (
    channel: string,
    callback: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      const startedAt = Date.now()
      runtimeLogger?.record('ipc', 'request', { channel })
      try {
        const result = await callback(event, ...args)
        runtimeLogger?.record('ipc', 'complete', { channel, durationMs: Date.now() - startedAt })
        return result
      } catch (error) {
        runtimeLogger?.record('ipc', 'error', {
          channel,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error)
        })
        throw error
      }
    })
  }
}
