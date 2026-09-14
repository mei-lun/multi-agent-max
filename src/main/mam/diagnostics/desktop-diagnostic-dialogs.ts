import { app, dialog, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { MamExportExecutionActivityInputSchema } from '../../../shared/mam/execution-activity-export'
import type { DiagnosticsRecorder } from './diagnostics-recorder'
import { selectExecutionActivityEvents } from './execution-activity-export-selection'
import { safeFileName } from './safe-file-name'

export async function selectLogDirectoryDialog(
  window: BrowserWindow,
  directory?: string
): Promise<string | undefined> {
  const result = await dialog.showOpenDialog(window, {
    title: 'Choose log directory',
    ...(directory ? { defaultPath: directory } : {}),
    properties: ['openDirectory', 'createDirectory']
  })
  return result.canceled ? undefined : result.filePaths[0]
}

export function exportDiagnosticsDialog(
  window: BrowserWindow,
  diagnostics: DiagnosticsRecorder
): () => Promise<string | undefined> {
  return async () => {
    const result = await dialog.showSaveDialog(window, {
      title: 'Export MAM diagnostics',
      defaultPath: join(app.getPath('documents'), 'mam-diagnostics.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return undefined
    return diagnostics.exportBundle(result.filePath)
  }
}

export function exportExecutionActivityDialog(
  window: BrowserWindow,
  diagnostics: DiagnosticsRecorder
): (input: unknown) => Promise<string | undefined> {
  return async (input) => {
    const parsed = MamExportExecutionActivityInputSchema.parse(input)
    const scope = parsed.nodeId ?? parsed.workflowRunId
    const result = await dialog.showSaveDialog(window, {
      title: parsed.nodeId ? 'Export node execution activity' : 'Export Run execution activity',
      defaultPath: join(app.getPath('documents'), `mam-execution-${safeFileName(scope)}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return undefined
    const events = selectExecutionActivityEvents(diagnostics.list(), parsed)
    return diagnostics.exportBundle(result.filePath, events)
  }
}
