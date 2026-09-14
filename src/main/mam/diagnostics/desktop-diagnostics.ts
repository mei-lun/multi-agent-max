import { app, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { diagnosticError } from './diagnostic-error'
import { DesktopRuntimeLogger } from './desktop-runtime-logger'
import type { DiagnosticsRecorder } from './diagnostics-recorder'
import { LOG_CLEANUP_INTERVAL_MS, prunePiRpcLogs } from './log-retention'

let cleanupTimer: NodeJS.Timeout | undefined

export function startDesktopLogging(mamRoot: string): DesktopRuntimeLogger {
  const logger = new DesktopRuntimeLogger(join(mamRoot, 'diagnostics', 'runtime.jsonl'))
  const stopHeartbeat = logger.startHeartbeat()
  logger.record('main', 'app_start', {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    versions: process.versions,
    diagnosticsDirectory: join(mamRoot, 'diagnostics')
  })
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    logger.record('main', 'uncaught_exception', { origin, error: diagnosticError(error) })
  })
  process.on('unhandledRejection', (error) => {
    logger.record('main', 'unhandled_rejection', { error: diagnosticError(error) })
  })
  app.on('child-process-gone', (_event, details) =>
    logger.record('main', 'child_process_gone', { ...details })
  )
  app.on('before-quit', () => logger.record('main', 'app_quit'))
  app.on('will-quit', () => {
    stopHeartbeat()
    if (cleanupTimer) clearInterval(cleanupTimer)
  })
  return logger
}

export function attachWindowDiagnostics(
  window: BrowserWindow,
  logger: DesktopRuntimeLogger,
  diagnostics: DiagnosticsRecorder,
  configRoots: () => readonly string[]
): void {
  const cleanup = (): void => {
    try {
      logger.prune()
      diagnostics.prune()
      prunePiRpcLogs(configRoots())
    } catch (error) {
      logger.record('logs', 'cleanup_failed', { error: diagnosticError(error) })
    }
  }
  cleanup()
  if (cleanupTimer) clearInterval(cleanupTimer)
  cleanupTimer = setInterval(cleanup, LOG_CLEANUP_INTERVAL_MS)
  cleanupTimer.unref()
  window.on('unresponsive', () => logger.record('window', 'unresponsive'))
  window.on('responsive', () => logger.record('window', 'responsive'))
  window.webContents.on('did-start-loading', () => logger.record('renderer', 'did_start_loading'))
  window.webContents.on('did-finish-load', () => logger.record('renderer', 'did_finish_load'))
  window.webContents.on('render-process-gone', (_event, details) =>
    logger.record('renderer', 'render_process_gone', { ...details })
  )
  window.webContents.on('preload-error', (_event, preloadPath, error) =>
    logger.record('renderer', 'preload_error', { preloadPath, error: diagnosticError(error) })
  )
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) =>
    logger.record('renderer', 'load_failed', { errorCode, errorDescription, url: validatedURL })
  )
  window.webContents.on('console-message', (details) => {
    if (details.level === 'warning' || details.level === 'error') {
      logger.record('renderer', 'console', {
        level: details.level,
        message: details.message,
        sourceId: details.sourceId,
        lineNumber: details.lineNumber
      })
    }
  })
}
