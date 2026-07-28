import { contextBridge, ipcRenderer } from 'electron'
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
  MAM_UI_SNAPSHOT_CHANGED_CHANNEL,
  MAM_RESOLVE_REVIEW_DISAGREEMENT_CHANNEL,
  MAM_RESOLVE_APPROVAL_GATE_CHANNEL,
  MAM_SAVE_WORKFLOW_CHANNEL,
  MAM_SAVE_LOCAL_SETTINGS_CHANNEL,
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
  async importSkill() {
    return ipcRenderer.invoke(MAM_IMPORT_SKILL_CHANNEL)
  },
  async exportDiagnostics() {
    return ipcRenderer.invoke(MAM_EXPORT_DIAGNOSTICS_CHANNEL)
  },
  onUiSnapshotChanged(listener) {
    const handler = () => listener()
    ipcRenderer.on(MAM_UI_SNAPSHOT_CHANGED_CHANNEL, handler)
    return () => ipcRenderer.removeListener(MAM_UI_SNAPSHOT_CHANGED_CHANNEL, handler)
  }
})

contextBridge.exposeInMainWorld('mam', api)
