import { app, dialog, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { MamUiCommandService } from './mam-ui-command-service'
import { safeFileName } from '../diagnostics/safe-file-name'

export function importWorkflowPackageDialog(
  window: BrowserWindow,
  commands: MamUiCommandService
): () => Promise<unknown> {
  return async () => {
    const result = await dialog.showOpenDialog(window, {
      title: 'Import a Workflow package',
      properties: ['openFile'],
      filters: [{ name: 'Workflow package', extensions: ['json'] }]
    })
    const filePath = result.filePaths[0]
    if (result.canceled || !filePath) return undefined
    return commands.importWorkflowPackage(filePath)
  }
}

export function exportWorkflowPackageDialog(
  window: BrowserWindow,
  commands: MamUiCommandService
): (input: unknown) => Promise<unknown> {
  return async (input) => {
    const parsed = input as { definitionId?: unknown }
    const definitionId = typeof parsed.definitionId === 'string' ? parsed.definitionId : 'workflow'
    const result = await dialog.showSaveDialog(window, {
      title: 'Export a Workflow package',
      defaultPath: join(app.getPath('documents'), `${safeFileName(definitionId)}-package.json`),
      filters: [{ name: 'Workflow package', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return undefined
    return commands.exportWorkflowPackage(input, result.filePath)
  }
}
