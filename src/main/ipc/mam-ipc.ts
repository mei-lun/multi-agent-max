import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { MamUiQueryService } from '../mam/application/mam-ui-query-service'
import type { MamUiCommandService } from '../mam/application/mam-ui-command-service'
import type { MamWorkflowRunCommandService } from '../mam/application/mam-workflow-run-command-service'
import type { MamAttemptExecutionService } from '../mam/application/mam-attempt-execution-service'
import type { MamAttemptInspectionService } from '../mam/application/mam-attempt-inspection-service'
import type { MamMergeQueueExecutionService } from '../mam/application/mam-merge-queue-execution-service'
import {
  MAM_ASSIGN_TASK_CHANNEL,
  MAM_CREATE_WORKFLOW_RUN_CHANNEL,
  MAM_GET_UI_SNAPSHOT_CHANNEL,
  MAM_GET_ATTEMPT_DIFF_CHANNEL,
  MAM_EXPORT_DIAGNOSTICS_CHANNEL,
  MAM_IMPORT_SKILL_CHANNEL,
  MAM_RECOVER_ATTEMPT_CHANNEL,
  MAM_START_ATTEMPT_CHANNEL,
  MAM_EXECUTE_NEXT_MERGE_CHANNEL,
  MAM_RESOLVE_REVIEW_DISAGREEMENT_CHANNEL,
  MAM_RESOLVE_APPROVAL_GATE_CHANNEL,
  MAM_SAVE_WORKFLOW_CHANNEL,
  MAM_SAVE_LOCAL_SETTINGS_CHANNEL,
  MAM_SAVE_PROFILE_CHANNEL,
  MAM_SELECT_ATTEMPT_CHANNEL,
  MAM_SUBMIT_REVIEW_CHANNEL,
  MAM_SELECT_PROJECT_CHANNEL
} from '../../shared/mam/application-api'

export function registerMamIpc(
  window: BrowserWindow,
  service: MamUiQueryService,
  commands: MamUiCommandService,
  workflowRuns: MamWorkflowRunCommandService,
  attempts: MamAttemptExecutionService,
  attemptInspection: MamAttemptInspectionService,
  mergeQueue: MamMergeQueueExecutionService,
  selectProject: () => Promise<unknown>,
  importSkill: () => Promise<unknown>,
  exportDiagnostics: () => Promise<unknown>
): () => void {
  ipcMain.handle(MAM_GET_UI_SNAPSHOT_CHANNEL, (event) => {
    assertTrustedRenderer(event, window)
    return service.getSnapshot()
  })
  ipcMain.handle(MAM_GET_ATTEMPT_DIFF_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return attemptInspection.getDiff(input)
  })
  ipcMain.handle(MAM_SELECT_PROJECT_CHANNEL, (event) => {
    assertTrustedRenderer(event, window)
    return selectProject()
  })
  ipcMain.handle(MAM_ASSIGN_TASK_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return commands.assignTask(input)
  })
  ipcMain.handle(MAM_RECOVER_ATTEMPT_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return commands.recoverAttempt(input)
  })
  ipcMain.handle(MAM_START_ATTEMPT_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return attempts.start(input)
  })
  ipcMain.handle(MAM_EXECUTE_NEXT_MERGE_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return mergeQueue.executeNext(input)
  })
  ipcMain.handle(MAM_SAVE_WORKFLOW_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return commands.saveWorkflow(input)
  })
  ipcMain.handle(MAM_CREATE_WORKFLOW_RUN_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return workflowRuns.create(input)
  })
  ipcMain.handle(MAM_SUBMIT_REVIEW_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return commands.submitReview(input)
  })
  ipcMain.handle(MAM_RESOLVE_REVIEW_DISAGREEMENT_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return commands.resolveReviewDisagreement(input)
  })
  ipcMain.handle(MAM_RESOLVE_APPROVAL_GATE_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return commands.resolveApprovalGate(input)
  })
  ipcMain.handle(MAM_SELECT_ATTEMPT_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return commands.selectAttempt(input)
  })
  ipcMain.handle(MAM_SAVE_PROFILE_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return commands.saveProfile(input)
  })
  ipcMain.handle(MAM_SAVE_LOCAL_SETTINGS_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return commands.saveLocalSettings(input)
  })
  ipcMain.handle(MAM_IMPORT_SKILL_CHANNEL, (event) => {
    assertTrustedRenderer(event, window)
    return importSkill()
  })
  ipcMain.handle(MAM_EXPORT_DIAGNOSTICS_CHANNEL, (event) => {
    assertTrustedRenderer(event, window)
    return exportDiagnostics()
  })
  return () => {
    ipcMain.removeHandler(MAM_GET_UI_SNAPSHOT_CHANNEL)
    ipcMain.removeHandler(MAM_GET_ATTEMPT_DIFF_CHANNEL)
    ipcMain.removeHandler(MAM_SELECT_PROJECT_CHANNEL)
    ipcMain.removeHandler(MAM_ASSIGN_TASK_CHANNEL)
    ipcMain.removeHandler(MAM_RECOVER_ATTEMPT_CHANNEL)
    ipcMain.removeHandler(MAM_START_ATTEMPT_CHANNEL)
    ipcMain.removeHandler(MAM_EXECUTE_NEXT_MERGE_CHANNEL)
    ipcMain.removeHandler(MAM_SAVE_WORKFLOW_CHANNEL)
    ipcMain.removeHandler(MAM_CREATE_WORKFLOW_RUN_CHANNEL)
    ipcMain.removeHandler(MAM_SUBMIT_REVIEW_CHANNEL)
    ipcMain.removeHandler(MAM_RESOLVE_REVIEW_DISAGREEMENT_CHANNEL)
    ipcMain.removeHandler(MAM_RESOLVE_APPROVAL_GATE_CHANNEL)
    ipcMain.removeHandler(MAM_SELECT_ATTEMPT_CHANNEL)
    ipcMain.removeHandler(MAM_SAVE_PROFILE_CHANNEL)
    ipcMain.removeHandler(MAM_SAVE_LOCAL_SETTINGS_CHANNEL)
    ipcMain.removeHandler(MAM_IMPORT_SKILL_CHANNEL)
    ipcMain.removeHandler(MAM_EXPORT_DIAGNOSTICS_CHANNEL)
  }
}

function assertTrustedRenderer(event: IpcMainInvokeEvent, window: BrowserWindow): void {
  if (window.isDestroyed() || event.sender !== window.webContents) {
    throw new Error('MAM IPC rejected an untrusted Renderer')
  }
  const frame = event.senderFrame
  if (!frame || frame !== window.webContents.mainFrame) {
    throw new Error('MAM IPC requires the main Renderer frame')
  }
}
