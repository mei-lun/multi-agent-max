import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { DesktopRuntimeLogger } from '../mam/diagnostics/desktop-runtime-logger'
import { diagnosticError } from '../mam/diagnostics/diagnostic-error'
import { randomUUID } from 'node:crypto'

export function mamIpcRequestHandler(runtimeLogger?: DesktopRuntimeLogger) {
  return (
    channel: string,
    callback: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      const startedAt = Date.now()
      const context = { channel, requestId: randomUUID(), ...requestIdentity(args[0]) }
      runtimeLogger?.record('ipc', 'request', context)
      try {
        const result = await callback(event, ...args)
        runtimeLogger?.record('ipc', 'complete', { ...context, durationMs: Date.now() - startedAt })
        return result
      } catch (error) {
        runtimeLogger?.record('ipc', 'error', {
          ...context,
          durationMs: Date.now() - startedAt,
          error: diagnosticError(error)
        })
        throw error
      }
    })
  }
}

function requestIdentity(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object') return {}
  const fields = input as Record<string, unknown>
  return Object.fromEntries(
    ['workflowRunId', 'taskId', 'attemptId', 'nodeId', 'roleProfileId', 'modelProfileId'].flatMap(
      (key) => (typeof fields[key] === 'string' ? [[key, fields[key]]] : [])
    )
  )
}
