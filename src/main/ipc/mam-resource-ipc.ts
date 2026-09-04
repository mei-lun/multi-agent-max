import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import {
  MAM_CHECK_RESOURCE_HEALTH_CHANNEL,
  MAM_IMPORT_CODEX_RESOURCES_CHANNEL,
  MAM_LIST_CODEX_RESOURCES_CHANNEL
} from '../../shared/mam/application-api'
import { assertTrustedRenderer } from './trusted-renderer-ipc'

export type MamResourceOperations = Readonly<{
  listCodexResources(): Promise<unknown>
  importCodexResources(input: unknown): Promise<unknown>
  checkResourceHealth(): Promise<unknown>
}>

type Handle = (
  channel: string,
  callback: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown | Promise<unknown>
) => void

export function registerMamResourceIpc(
  handle: Handle,
  window: BrowserWindow,
  operations: MamResourceOperations
): () => void {
  handle(MAM_LIST_CODEX_RESOURCES_CHANNEL, (event) => {
    assertTrustedRenderer(event, window)
    return operations.listCodexResources()
  })
  handle(MAM_IMPORT_CODEX_RESOURCES_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return operations.importCodexResources(input)
  })
  handle(MAM_CHECK_RESOURCE_HEALTH_CHANNEL, (event) => {
    assertTrustedRenderer(event, window)
    return operations.checkResourceHealth()
  })
  return () => {
    ipcMain.removeHandler(MAM_LIST_CODEX_RESOURCES_CHANNEL)
    ipcMain.removeHandler(MAM_IMPORT_CODEX_RESOURCES_CHANNEL)
    ipcMain.removeHandler(MAM_CHECK_RESOURCE_HEALTH_CHANNEL)
  }
}
