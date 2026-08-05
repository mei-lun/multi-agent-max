import { contextBridge, ipcRenderer } from 'electron'
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
  MAM_GET_DESIGN_DRAFT_CHANNEL,
  MAM_SELECT_DESIGN_MODEL_CHANNEL,
  MAM_SEND_DESIGN_MESSAGE_CHANNEL,
  MAM_CANCEL_DESIGN_MESSAGE_CHANNEL,
  MAM_RESET_DESIGN_DRAFT_CHANNEL,
  MAM_UPDATE_DESIGN_PROPOSAL_CHANNEL,
  MAM_APPLY_DESIGN_PROPOSAL_CHANNEL,
  MAM_CREATE_DESIGN_TEMPLATE_CHANNEL,
  MAM_RETRY_DESIGN_GENERATION_CHANNEL,
  MAM_IMPORT_SKILL_CHANNEL,
  MAM_RECOVER_ATTEMPT_CHANNEL,
  MAM_START_ATTEMPT_CHANNEL,
  MAM_EXECUTE_NEXT_MERGE_CHANNEL,
  MAM_UI_SNAPSHOT_CHANGED_CHANNEL,
  MAM_RESOLVE_REVIEW_DISAGREEMENT_CHANNEL,
  MAM_RESOLVE_APPROVAL_GATE_CHANNEL,
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
  MAM_SELECT_PROJECT_CHANNEL,
  MAM_SUBMIT_REVIEW_CHANNEL,
  type MamRendererApi
} from '../shared/mam/application-api'

const api: MamRendererApi = Object.freeze({
  async getUiSnapshot() {
    return ipcRenderer.invoke(MAM_GET_UI_SNAPSHOT_CHANNEL)
  },
  async getAttemptDiff(input) {
    return ipcRenderer.invoke(MAM_GET_ATTEMPT_DIFF_CHANNEL, input)
  },
  async selectProject() {
    return ipcRenderer.invoke(MAM_SELECT_PROJECT_CHANNEL)
  },
  async assignTask(input) {
    return ipcRenderer.invoke(MAM_ASSIGN_TASK_CHANNEL, input)
  },
  async reassignTask(input) {
    return ipcRenderer.invoke(MAM_REASSIGN_TASK_CHANNEL, input)
  },
  async recoverAttempt(input) {
    return ipcRenderer.invoke(MAM_RECOVER_ATTEMPT_CHANNEL, input)
  },
  async startAttempt(input) {
    return ipcRenderer.invoke(MAM_START_ATTEMPT_CHANNEL, input)
  },
  async executeNextMerge(input) {
    return ipcRenderer.invoke(MAM_EXECUTE_NEXT_MERGE_CHANNEL, input)
  },
  async saveWorkflow(input) {
    return ipcRenderer.invoke(MAM_SAVE_WORKFLOW_CHANNEL, input)
  },
  async createWorkflowRun(input) {
    return ipcRenderer.invoke(MAM_CREATE_WORKFLOW_RUN_CHANNEL, input)
  },
  async cancelWorkflowRun(input) {
    return ipcRenderer.invoke(MAM_CANCEL_WORKFLOW_RUN_CHANNEL, input)
  },
  async restartWorkflowRun(input) {
    return ipcRenderer.invoke(MAM_RESTART_WORKFLOW_RUN_CHANNEL, input)
  },
  async submitReview(input) {
    return ipcRenderer.invoke(MAM_SUBMIT_REVIEW_CHANNEL, input)
  },
  async resolveReviewDisagreement(input) {
    return ipcRenderer.invoke(MAM_RESOLVE_REVIEW_DISAGREEMENT_CHANNEL, input)
  },
  async resolveApprovalGate(input) {
    return ipcRenderer.invoke(MAM_RESOLVE_APPROVAL_GATE_CHANNEL, input)
  },
  async selectAttempt(input) {
    return ipcRenderer.invoke(MAM_SELECT_ATTEMPT_CHANNEL, input)
  },
  async saveProfile(input) {
    return ipcRenderer.invoke(MAM_SAVE_PROFILE_CHANNEL, input)
  },
  async saveLocalSettings(input) {
    return ipcRenderer.invoke(MAM_SAVE_LOCAL_SETTINGS_CHANNEL, input)
  },
  async saveModelConnection(input) {
    return ipcRenderer.invoke(MAM_SAVE_MODEL_CONNECTION_CHANNEL, input)
  },
  async fetchModelCatalog(input) {
    return ipcRenderer.invoke(MAM_FETCH_MODEL_CATALOG_CHANNEL, input)
  },
  async deleteRoleProfile(input) {
    return ipcRenderer.invoke(MAM_DELETE_ROLE_PROFILE_CHANNEL, input)
  },
  async deleteWorkflow(input) {
    return ipcRenderer.invoke(MAM_DELETE_WORKFLOW_CHANNEL, input)
  },
  async importWorkflowPackage() {
    return ipcRenderer.invoke(MAM_IMPORT_WORKFLOW_PACKAGE_CHANNEL)
  },
  async exportWorkflowPackage(input) {
    return ipcRenderer.invoke(MAM_EXPORT_WORKFLOW_PACKAGE_CHANNEL, input)
  },
  async importSkill() {
    return ipcRenderer.invoke(MAM_IMPORT_SKILL_CHANNEL)
  },
  async exportDiagnostics() {
    return ipcRenderer.invoke(MAM_EXPORT_DIAGNOSTICS_CHANNEL)
  },
  async exportExecutionActivity(input) {
    return ipcRenderer.invoke(MAM_EXPORT_EXECUTION_ACTIVITY_CHANNEL, input)
  },
  async getDesignDraft() {
    return ipcRenderer.invoke(MAM_GET_DESIGN_DRAFT_CHANNEL)
  },
  async selectDesignModel(input) {
    return ipcRenderer.invoke(MAM_SELECT_DESIGN_MODEL_CHANNEL, input)
  },
  async sendDesignMessage(input) {
    return ipcRenderer.invoke(MAM_SEND_DESIGN_MESSAGE_CHANNEL, input)
  },
  async cancelDesignMessage(input) {
    return ipcRenderer.invoke(MAM_CANCEL_DESIGN_MESSAGE_CHANNEL, input)
  },
  async resetDesignDraft(input) {
    return ipcRenderer.invoke(MAM_RESET_DESIGN_DRAFT_CHANNEL, input)
  },
  async createDesignTemplate(input) {
    return ipcRenderer.invoke(MAM_CREATE_DESIGN_TEMPLATE_CHANNEL, input)
  },
  async retryDesignGeneration(input) {
    return ipcRenderer.invoke(MAM_RETRY_DESIGN_GENERATION_CHANNEL, input)
  },
  async updateDesignProposal(input) {
    return ipcRenderer.invoke(MAM_UPDATE_DESIGN_PROPOSAL_CHANNEL, input)
  },
  async applyDesignProposal(input) {
    return ipcRenderer.invoke(MAM_APPLY_DESIGN_PROPOSAL_CHANNEL, input)
  },
  onUiSnapshotChanged(listener) {
    const handler = () => listener()
    ipcRenderer.on(MAM_UI_SNAPSHOT_CHANGED_CHANNEL, handler)
    return () => ipcRenderer.removeListener(MAM_UI_SNAPSHOT_CHANGED_CHANNEL, handler)
  }
})

contextBridge.exposeInMainWorld('mam', api)
