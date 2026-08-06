import type { MamUiSnapshot } from './ui-projection'
import type { MamAttemptDiff, MamGetAttemptDiffInput } from './attempt-inspection'
import type {
  MamAssignTaskInput,
  MamCancelWorkflowRunInput,
  MamReassignTaskInput,
  MamCreateWorkflowRunInput,
  MamRecoverAttemptInput,
  MamRestartWorkflowRunInput,
  MamResolveReviewDisagreementInput,
  MamResolveApprovalGateInput,
  MamAnswerHumanQuestionsInput,
  MamConfirmHumanUnderstandingInput,
  MamReviseHumanUnderstandingInput,
  MamResolveHumanReviewInput,
  MamSaveLocalSettingsInput,
  MamSaveModelConnectionInput,
  MamDeleteRoleProfileInput,
  MamDeleteWorkflowInput,
  MamExportWorkflowPackageInput,
  MamSaveProfileInput,
  MamSelectAttemptInput,
  MamSubmitReviewInput,
  MamSaveWorkflowInput,
  MamStartAttemptInput,
  MamExecuteNextMergeInput
} from './application-command'
import type { MamFetchModelCatalogInput, MamModelCatalogResult } from './model-catalog'
import type { MamExportExecutionActivityInput } from './execution-activity-export'
import type {
  MamDesignApplyProposalInput,
  MamDesignCancelInput,
  MamDesignCreateTemplateInput,
  MamDesignDraft,
  MamDesignResetInput,
  MamDesignRetryInput,
  MamDesignSelectModelInput,
  MamDesignSendMessageInput,
  MamDesignUpdateProposalInput
} from './design-assistant'

export const MAM_GET_UI_SNAPSHOT_CHANNEL = 'mam:get-ui-snapshot'
export const MAM_GET_ATTEMPT_DIFF_CHANNEL = 'mam:get-attempt-diff'
export const MAM_SELECT_PROJECT_CHANNEL = 'mam:select-project'
export const MAM_ASSIGN_TASK_CHANNEL = 'mam:assign-task'
export const MAM_REASSIGN_TASK_CHANNEL = 'mam:reassign-task'
export const MAM_RECOVER_ATTEMPT_CHANNEL = 'mam:recover-attempt'
export const MAM_START_ATTEMPT_CHANNEL = 'mam:start-attempt'
export const MAM_EXECUTE_NEXT_MERGE_CHANNEL = 'mam:execute-next-merge'
export const MAM_UI_SNAPSHOT_CHANGED_CHANNEL = 'mam:ui-snapshot-changed'
export const MAM_SAVE_WORKFLOW_CHANNEL = 'mam:save-workflow'
export const MAM_CREATE_WORKFLOW_RUN_CHANNEL = 'mam:create-workflow-run'
export const MAM_CANCEL_WORKFLOW_RUN_CHANNEL = 'mam:cancel-workflow-run'
export const MAM_RESTART_WORKFLOW_RUN_CHANNEL = 'mam:restart-workflow-run'
export const MAM_SUBMIT_REVIEW_CHANNEL = 'mam:submit-review'
export const MAM_RESOLVE_REVIEW_DISAGREEMENT_CHANNEL = 'mam:resolve-review-disagreement'
export const MAM_RESOLVE_APPROVAL_GATE_CHANNEL = 'mam:resolve-approval-gate'
export const MAM_ANSWER_HUMAN_QUESTIONS_CHANNEL = 'mam:answer-human-questions'
export const MAM_CONFIRM_HUMAN_UNDERSTANDING_CHANNEL = 'mam:confirm-human-understanding'
export const MAM_REVISE_HUMAN_UNDERSTANDING_CHANNEL = 'mam:revise-human-understanding'
export const MAM_RESOLVE_HUMAN_REVIEW_CHANNEL = 'mam:resolve-human-review'
export const MAM_SELECT_ATTEMPT_CHANNEL = 'mam:select-attempt'
export const MAM_SAVE_PROFILE_CHANNEL = 'mam:save-profile'
export const MAM_SAVE_LOCAL_SETTINGS_CHANNEL = 'mam:save-local-settings'
export const MAM_SAVE_MODEL_CONNECTION_CHANNEL = 'mam:save-model-connection'
export const MAM_FETCH_MODEL_CATALOG_CHANNEL = 'mam:fetch-model-catalog'
export const MAM_DELETE_ROLE_PROFILE_CHANNEL = 'mam:delete-role-profile'
export const MAM_DELETE_WORKFLOW_CHANNEL = 'mam:delete-workflow'
export const MAM_IMPORT_WORKFLOW_PACKAGE_CHANNEL = 'mam:import-workflow-package'
export const MAM_EXPORT_WORKFLOW_PACKAGE_CHANNEL = 'mam:export-workflow-package'
export const MAM_IMPORT_SKILL_CHANNEL = 'mam:import-skill'
export const MAM_EXPORT_DIAGNOSTICS_CHANNEL = 'mam:export-diagnostics'
export const MAM_EXPORT_EXECUTION_ACTIVITY_CHANNEL = 'mam:export-execution-activity'
export const MAM_GET_DESIGN_DRAFT_CHANNEL = 'mam:get-design-draft'
export const MAM_SELECT_DESIGN_MODEL_CHANNEL = 'mam:select-design-model'
export const MAM_SEND_DESIGN_MESSAGE_CHANNEL = 'mam:send-design-message'
export const MAM_CANCEL_DESIGN_MESSAGE_CHANNEL = 'mam:cancel-design-message'
export const MAM_RESET_DESIGN_DRAFT_CHANNEL = 'mam:reset-design-draft'
export const MAM_UPDATE_DESIGN_PROPOSAL_CHANNEL = 'mam:update-design-proposal'
export const MAM_APPLY_DESIGN_PROPOSAL_CHANNEL = 'mam:apply-design-proposal'
export const MAM_CREATE_DESIGN_TEMPLATE_CHANNEL = 'mam:create-design-template'
export const MAM_RETRY_DESIGN_GENERATION_CHANNEL = 'mam:retry-design-generation'

export type MamRendererApi = Readonly<{
  getUiSnapshot(): Promise<MamUiSnapshot>
  getAttemptDiff(input: MamGetAttemptDiffInput): Promise<MamAttemptDiff>
  selectProject(): Promise<MamUiSnapshot | undefined>
  assignTask(input: MamAssignTaskInput): Promise<MamUiSnapshot>
  reassignTask(input: MamReassignTaskInput): Promise<MamUiSnapshot>
  recoverAttempt(input: MamRecoverAttemptInput): Promise<MamUiSnapshot>
  startAttempt(input: MamStartAttemptInput): Promise<MamUiSnapshot>
  executeNextMerge(input: MamExecuteNextMergeInput): Promise<MamUiSnapshot>
  saveWorkflow(input: MamSaveWorkflowInput): Promise<MamUiSnapshot>
  createWorkflowRun(input: MamCreateWorkflowRunInput): Promise<MamUiSnapshot>
  cancelWorkflowRun(input: MamCancelWorkflowRunInput): Promise<MamUiSnapshot>
  restartWorkflowRun(input: MamRestartWorkflowRunInput): Promise<MamUiSnapshot>
  submitReview(input: MamSubmitReviewInput): Promise<MamUiSnapshot>
  resolveReviewDisagreement(input: MamResolveReviewDisagreementInput): Promise<MamUiSnapshot>
  resolveApprovalGate(input: MamResolveApprovalGateInput): Promise<MamUiSnapshot>
  answerHumanQuestions(input: MamAnswerHumanQuestionsInput): Promise<MamUiSnapshot>
  confirmHumanUnderstanding(input: MamConfirmHumanUnderstandingInput): Promise<MamUiSnapshot>
  reviseHumanUnderstanding(input: MamReviseHumanUnderstandingInput): Promise<MamUiSnapshot>
  resolveHumanReview(input: MamResolveHumanReviewInput): Promise<MamUiSnapshot>
  selectAttempt(input: MamSelectAttemptInput): Promise<MamUiSnapshot>
  saveProfile(input: MamSaveProfileInput): Promise<MamUiSnapshot>
  saveLocalSettings(input: MamSaveLocalSettingsInput): Promise<MamUiSnapshot>
  saveModelConnection(input: MamSaveModelConnectionInput): Promise<MamUiSnapshot>
  fetchModelCatalog(input: MamFetchModelCatalogInput): Promise<MamModelCatalogResult>
  deleteRoleProfile(input: MamDeleteRoleProfileInput): Promise<MamUiSnapshot>
  deleteWorkflow(input: MamDeleteWorkflowInput): Promise<MamUiSnapshot>
  importWorkflowPackage(): Promise<MamUiSnapshot | undefined>
  exportWorkflowPackage(input: MamExportWorkflowPackageInput): Promise<string | undefined>
  importSkill(): Promise<MamUiSnapshot | undefined>
  exportDiagnostics(): Promise<string | undefined>
  exportExecutionActivity(input: MamExportExecutionActivityInput): Promise<string | undefined>
  getDesignDraft(): Promise<MamDesignDraft>
  selectDesignModel(input: MamDesignSelectModelInput): Promise<MamDesignDraft>
  sendDesignMessage(input: MamDesignSendMessageInput): Promise<MamDesignDraft>
  cancelDesignMessage(input: MamDesignCancelInput): Promise<void>
  resetDesignDraft(input: MamDesignResetInput): Promise<MamDesignDraft>
  createDesignTemplate(input: MamDesignCreateTemplateInput): Promise<MamDesignDraft>
  retryDesignGeneration(input: MamDesignRetryInput): Promise<MamDesignDraft>
  updateDesignProposal(input: MamDesignUpdateProposalInput): Promise<MamDesignDraft>
  applyDesignProposal(input: MamDesignApplyProposalInput): Promise<MamUiSnapshot>
  onUiSnapshotChanged(listener: () => void): () => void
}>
