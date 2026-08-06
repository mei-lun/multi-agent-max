import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { MamUiQueryService } from '../mam/application/mam-ui-query-service'
import type { MamUiCommandService } from '../mam/application/mam-ui-command-service'
import type { MamWorkflowRunCommandService } from '../mam/application/mam-workflow-run-command-service'
import type { MamAttemptExecutionService } from '../mam/application/mam-attempt-execution-service'
import type { MamAttemptInspectionService } from '../mam/application/mam-attempt-inspection-service'
import type { MamMergeQueueExecutionService } from '../mam/application/mam-merge-queue-execution-service'
import type { MamDesignAssistantService } from '../mam/application/mam-design-assistant-service'
import type { DesktopRuntimeLogger } from '../mam/diagnostics/desktop-runtime-logger'
import {
  MAM_ASSIGN_TASK_CHANNEL,
  MAM_REASSIGN_TASK_CHANNEL,
  MAM_CANCEL_WORKFLOW_RUN_CHANNEL,
  MAM_CREATE_WORKFLOW_RUN_CHANNEL,
  MAM_RESTART_WORKFLOW_RUN_CHANNEL,
  MAM_GET_UI_SNAPSHOT_CHANNEL,
  MAM_GET_ATTEMPT_DIFF_CHANNEL,
  MAM_EXPORT_DIAGNOSTICS_CHANNEL,
  MAM_EXPORT_EXECUTION_ACTIVITY_CHANNEL,
  MAM_IMPORT_SKILL_CHANNEL,
  MAM_RECOVER_ATTEMPT_CHANNEL,
  MAM_START_ATTEMPT_CHANNEL,
  MAM_EXECUTE_NEXT_MERGE_CHANNEL,
  MAM_RESOLVE_REVIEW_DISAGREEMENT_CHANNEL,
  MAM_RESOLVE_APPROVAL_GATE_CHANNEL,
  MAM_ANSWER_HUMAN_QUESTIONS_CHANNEL,
  MAM_CONFIRM_HUMAN_UNDERSTANDING_CHANNEL,
  MAM_REVISE_HUMAN_UNDERSTANDING_CHANNEL,
  MAM_RESOLVE_HUMAN_REVIEW_CHANNEL,
  MAM_SAVE_WORKFLOW_CHANNEL,
  MAM_SAVE_LOCAL_SETTINGS_CHANNEL,
  MAM_SAVE_MODEL_CONNECTION_CHANNEL,
  MAM_FETCH_MODEL_CATALOG_CHANNEL,
  MAM_DELETE_ROLE_PROFILE_CHANNEL,
  MAM_DELETE_WORKFLOW_CHANNEL,
  MAM_IMPORT_WORKFLOW_PACKAGE_CHANNEL,
  MAM_EXPORT_WORKFLOW_PACKAGE_CHANNEL,
  MAM_SAVE_PROFILE_CHANNEL,
  MAM_SELECT_ATTEMPT_CHANNEL,
  MAM_SUBMIT_REVIEW_CHANNEL,
  MAM_SELECT_PROJECT_CHANNEL,
  MAM_GET_DESIGN_DRAFT_CHANNEL,
  MAM_SELECT_DESIGN_MODEL_CHANNEL,
  MAM_SEND_DESIGN_MESSAGE_CHANNEL,
  MAM_CANCEL_DESIGN_MESSAGE_CHANNEL,
  MAM_RESET_DESIGN_DRAFT_CHANNEL,
  MAM_UPDATE_DESIGN_PROPOSAL_CHANNEL,
  MAM_APPLY_DESIGN_PROPOSAL_CHANNEL,
  MAM_CREATE_DESIGN_TEMPLATE_CHANNEL,
  MAM_RETRY_DESIGN_GENERATION_CHANNEL
} from '../../shared/mam/application-api'
import { assertTrustedRenderer } from './trusted-renderer-ipc'

export function registerMamIpc(
  window: BrowserWindow,
  service: MamUiQueryService,
  commands: MamUiCommandService,
  designs: MamDesignAssistantService,
  workflowRuns: MamWorkflowRunCommandService,
  attempts: MamAttemptExecutionService,
  attemptInspection: MamAttemptInspectionService,
  mergeQueue: MamMergeQueueExecutionService,
  selectProject: () => Promise<unknown>,
  importSkill: () => Promise<unknown>,
  importWorkflowPackage: () => Promise<unknown>,
  exportWorkflowPackage: (input: unknown) => Promise<unknown>,
  exportDiagnostics: () => Promise<unknown>,
  exportExecutionActivity: (input: unknown) => Promise<unknown>,
  runtimeLogger?: DesktopRuntimeLogger
): () => void {
  const handle = (
    channel: string,
    callback: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown | Promise<unknown>
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

  handle(MAM_GET_UI_SNAPSHOT_CHANNEL, (event) => {
    assertTrustedRenderer(event, window)
    return service.getSnapshot()
  })
  handle(MAM_GET_DESIGN_DRAFT_CHANNEL, (event) => {
    assertTrustedRenderer(event, window)
    return designs.getDraft()
  })
  handle(MAM_SELECT_DESIGN_MODEL_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return designs.selectModel(input)
  })
  handle(MAM_SEND_DESIGN_MESSAGE_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return designs.sendMessage(input)
  })
  handle(MAM_CANCEL_DESIGN_MESSAGE_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return designs.cancel(input)
  })
  handle(MAM_RESET_DESIGN_DRAFT_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return designs.reset(input)
  })
  handle(MAM_CREATE_DESIGN_TEMPLATE_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return designs.createTemplate(input)
  })
  handle(MAM_RETRY_DESIGN_GENERATION_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return designs.retry(input)
  })
  handle(MAM_UPDATE_DESIGN_PROPOSAL_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return designs.updateProposal(input)
  })
  handle(MAM_APPLY_DESIGN_PROPOSAL_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return designs.applyProposal(input)
  })
  handle(MAM_GET_ATTEMPT_DIFF_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return attemptInspection.getDiff(input)
  })
  handle(MAM_SELECT_PROJECT_CHANNEL, (event) => {
    assertTrustedRenderer(event, window)
    return selectProject()
  })
  handle(MAM_ASSIGN_TASK_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return commands.assignTask(input)
  })
  handle(MAM_REASSIGN_TASK_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return commands.reassignTask(input)
  })
  handle(MAM_RECOVER_ATTEMPT_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return commands.recoverAttempt(input)
  })
  handle(MAM_START_ATTEMPT_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return attempts.start(input)
  })
  handle(MAM_EXECUTE_NEXT_MERGE_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return mergeQueue.executeNext(input)
  })
  handle(MAM_SAVE_WORKFLOW_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return commands.saveWorkflow(input)
  })
  handle(MAM_CREATE_WORKFLOW_RUN_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return workflowRuns.create(input)
  })
  handle(MAM_CANCEL_WORKFLOW_RUN_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return workflowRuns.cancel(input)
  })
  handle(MAM_RESTART_WORKFLOW_RUN_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return workflowRuns.restart(input)
  })
  handle(MAM_SUBMIT_REVIEW_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return commands.submitReview(input)
  })
  handle(MAM_RESOLVE_REVIEW_DISAGREEMENT_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return commands.resolveReviewDisagreement(input)
  })
  handle(MAM_RESOLVE_APPROVAL_GATE_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return commands.resolveApprovalGate(input)
  })
  handle(MAM_ANSWER_HUMAN_QUESTIONS_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return commands.answerHumanQuestions(input)
  })
  handle(MAM_CONFIRM_HUMAN_UNDERSTANDING_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return commands.confirmHumanUnderstanding(input)
  })
  handle(MAM_REVISE_HUMAN_UNDERSTANDING_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return commands.reviseHumanUnderstanding(input)
  })
  handle(MAM_RESOLVE_HUMAN_REVIEW_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return commands.resolveHumanReview(input)
  })
  handle(MAM_SELECT_ATTEMPT_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return commands.selectAttempt(input)
  })
  handle(MAM_SAVE_PROFILE_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return commands.saveProfile(input)
  })
  handle(MAM_SAVE_LOCAL_SETTINGS_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return commands.saveLocalSettings(input)
  })
  handle(MAM_SAVE_MODEL_CONNECTION_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return commands.saveModelConnection(input)
  })
  handle(MAM_FETCH_MODEL_CATALOG_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return commands.fetchModelCatalog(input)
  })
  handle(MAM_DELETE_ROLE_PROFILE_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return commands.deleteRoleProfile(input)
  })
  handle(MAM_DELETE_WORKFLOW_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return commands.deleteWorkflow(input)
  })
  handle(MAM_IMPORT_WORKFLOW_PACKAGE_CHANNEL, (event) => {
    assertTrustedRenderer(event, window)
    return importWorkflowPackage()
  })
  handle(MAM_EXPORT_WORKFLOW_PACKAGE_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return exportWorkflowPackage(input)
  })
  handle(MAM_IMPORT_SKILL_CHANNEL, (event) => {
    assertTrustedRenderer(event, window)
    return importSkill()
  })
  handle(MAM_EXPORT_DIAGNOSTICS_CHANNEL, (event) => {
    assertTrustedRenderer(event, window)
    return exportDiagnostics()
  })
  handle(MAM_EXPORT_EXECUTION_ACTIVITY_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return exportExecutionActivity(input)
  })
  return () => {
    ipcMain.removeHandler(MAM_GET_UI_SNAPSHOT_CHANNEL)
    ipcMain.removeHandler(MAM_GET_DESIGN_DRAFT_CHANNEL)
    ipcMain.removeHandler(MAM_SELECT_DESIGN_MODEL_CHANNEL)
    ipcMain.removeHandler(MAM_SEND_DESIGN_MESSAGE_CHANNEL)
    ipcMain.removeHandler(MAM_CANCEL_DESIGN_MESSAGE_CHANNEL)
    ipcMain.removeHandler(MAM_RESET_DESIGN_DRAFT_CHANNEL)
    ipcMain.removeHandler(MAM_CREATE_DESIGN_TEMPLATE_CHANNEL)
    ipcMain.removeHandler(MAM_RETRY_DESIGN_GENERATION_CHANNEL)
    ipcMain.removeHandler(MAM_UPDATE_DESIGN_PROPOSAL_CHANNEL)
    ipcMain.removeHandler(MAM_APPLY_DESIGN_PROPOSAL_CHANNEL)
    ipcMain.removeHandler(MAM_GET_ATTEMPT_DIFF_CHANNEL)
    ipcMain.removeHandler(MAM_SELECT_PROJECT_CHANNEL)
    ipcMain.removeHandler(MAM_ASSIGN_TASK_CHANNEL)
    ipcMain.removeHandler(MAM_REASSIGN_TASK_CHANNEL)
    ipcMain.removeHandler(MAM_CANCEL_WORKFLOW_RUN_CHANNEL)
    ipcMain.removeHandler(MAM_RECOVER_ATTEMPT_CHANNEL)
    ipcMain.removeHandler(MAM_START_ATTEMPT_CHANNEL)
    ipcMain.removeHandler(MAM_RESTART_WORKFLOW_RUN_CHANNEL)
    ipcMain.removeHandler(MAM_EXECUTE_NEXT_MERGE_CHANNEL)
    ipcMain.removeHandler(MAM_SAVE_WORKFLOW_CHANNEL)
    ipcMain.removeHandler(MAM_CREATE_WORKFLOW_RUN_CHANNEL)
    ipcMain.removeHandler(MAM_SUBMIT_REVIEW_CHANNEL)
    ipcMain.removeHandler(MAM_RESOLVE_REVIEW_DISAGREEMENT_CHANNEL)
    ipcMain.removeHandler(MAM_RESOLVE_APPROVAL_GATE_CHANNEL)
    ipcMain.removeHandler(MAM_ANSWER_HUMAN_QUESTIONS_CHANNEL)
    ipcMain.removeHandler(MAM_CONFIRM_HUMAN_UNDERSTANDING_CHANNEL)
    ipcMain.removeHandler(MAM_REVISE_HUMAN_UNDERSTANDING_CHANNEL)
    ipcMain.removeHandler(MAM_RESOLVE_HUMAN_REVIEW_CHANNEL)
    ipcMain.removeHandler(MAM_SELECT_ATTEMPT_CHANNEL)
    ipcMain.removeHandler(MAM_SAVE_PROFILE_CHANNEL)
    ipcMain.removeHandler(MAM_SAVE_LOCAL_SETTINGS_CHANNEL)
    ipcMain.removeHandler(MAM_SAVE_MODEL_CONNECTION_CHANNEL)
    ipcMain.removeHandler(MAM_FETCH_MODEL_CATALOG_CHANNEL)
    ipcMain.removeHandler(MAM_DELETE_ROLE_PROFILE_CHANNEL)
    ipcMain.removeHandler(MAM_DELETE_WORKFLOW_CHANNEL)
    ipcMain.removeHandler(MAM_IMPORT_WORKFLOW_PACKAGE_CHANNEL)
    ipcMain.removeHandler(MAM_EXPORT_WORKFLOW_PACKAGE_CHANNEL)
    ipcMain.removeHandler(MAM_IMPORT_SKILL_CHANNEL)
    ipcMain.removeHandler(MAM_EXPORT_DIAGNOSTICS_CHANNEL)
    ipcMain.removeHandler(MAM_EXPORT_EXECUTION_ACTIVITY_CHANNEL)
  }
}
