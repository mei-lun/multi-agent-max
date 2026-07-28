import type { MamUiSnapshot } from './ui-projection'
import type { MamAttemptDiff, MamGetAttemptDiffInput } from './attempt-inspection'
import type {
  MamAssignTaskInput,
  MamCreateWorkflowRunInput,
  MamRecoverAttemptInput,
  MamResolveReviewDisagreementInput,
  MamResolveApprovalGateInput,
  MamSaveLocalSettingsInput,
  MamSaveProfileInput,
  MamSelectAttemptInput,
  MamSubmitReviewInput,
  MamSaveWorkflowInput,
  MamStartAttemptInput,
  MamExecuteNextMergeInput
} from './application-command'

export const MAM_GET_UI_SNAPSHOT_CHANNEL = 'mam:get-ui-snapshot'
export const MAM_GET_ATTEMPT_DIFF_CHANNEL = 'mam:get-attempt-diff'
export const MAM_SELECT_PROJECT_CHANNEL = 'mam:select-project'
export const MAM_ASSIGN_TASK_CHANNEL = 'mam:assign-task'
export const MAM_RECOVER_ATTEMPT_CHANNEL = 'mam:recover-attempt'
export const MAM_START_ATTEMPT_CHANNEL = 'mam:start-attempt'
export const MAM_EXECUTE_NEXT_MERGE_CHANNEL = 'mam:execute-next-merge'
export const MAM_UI_SNAPSHOT_CHANGED_CHANNEL = 'mam:ui-snapshot-changed'
export const MAM_SAVE_WORKFLOW_CHANNEL = 'mam:save-workflow'
export const MAM_CREATE_WORKFLOW_RUN_CHANNEL = 'mam:create-workflow-run'
export const MAM_SUBMIT_REVIEW_CHANNEL = 'mam:submit-review'
export const MAM_RESOLVE_REVIEW_DISAGREEMENT_CHANNEL = 'mam:resolve-review-disagreement'
export const MAM_RESOLVE_APPROVAL_GATE_CHANNEL = 'mam:resolve-approval-gate'
export const MAM_SELECT_ATTEMPT_CHANNEL = 'mam:select-attempt'
export const MAM_SAVE_PROFILE_CHANNEL = 'mam:save-profile'
export const MAM_SAVE_LOCAL_SETTINGS_CHANNEL = 'mam:save-local-settings'
export const MAM_IMPORT_SKILL_CHANNEL = 'mam:import-skill'
export const MAM_EXPORT_DIAGNOSTICS_CHANNEL = 'mam:export-diagnostics'

export type MamRendererApi = Readonly<{
  getUiSnapshot(): Promise<MamUiSnapshot>
  getAttemptDiff(input: MamGetAttemptDiffInput): Promise<MamAttemptDiff>
  selectProject(): Promise<MamUiSnapshot | undefined>
  assignTask(input: MamAssignTaskInput): Promise<MamUiSnapshot>
  recoverAttempt(input: MamRecoverAttemptInput): Promise<MamUiSnapshot>
  startAttempt(input: MamStartAttemptInput): Promise<MamUiSnapshot>
  executeNextMerge(input: MamExecuteNextMergeInput): Promise<MamUiSnapshot>
  saveWorkflow(input: MamSaveWorkflowInput): Promise<MamUiSnapshot>
  createWorkflowRun(input: MamCreateWorkflowRunInput): Promise<MamUiSnapshot>
  submitReview(input: MamSubmitReviewInput): Promise<MamUiSnapshot>
  resolveReviewDisagreement(input: MamResolveReviewDisagreementInput): Promise<MamUiSnapshot>
  resolveApprovalGate(input: MamResolveApprovalGateInput): Promise<MamUiSnapshot>
  selectAttempt(input: MamSelectAttemptInput): Promise<MamUiSnapshot>
  saveProfile(input: MamSaveProfileInput): Promise<MamUiSnapshot>
  saveLocalSettings(input: MamSaveLocalSettingsInput): Promise<MamUiSnapshot>
  importSkill(): Promise<MamUiSnapshot | undefined>
  exportDiagnostics(): Promise<string | undefined>
  onUiSnapshotChanged(listener: () => void): () => void
}>
