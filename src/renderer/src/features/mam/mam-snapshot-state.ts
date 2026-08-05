import type {
  MamAssignTaskInput,
  MamCancelWorkflowRunInput,
  MamCreateWorkflowRunInput,
  MamDeleteRoleProfileInput,
  MamExecuteNextMergeInput,
  MamReassignTaskInput,
  MamRecoverAttemptInput,
  MamResolveApprovalGateInput,
  MamResolveReviewDisagreementInput,
  MamRestartWorkflowRunInput,
  MamSaveLocalSettingsInput,
  MamSaveModelConnectionInput,
  MamSaveProfileInput,
  MamSaveWorkflowInput,
  MamSelectAttemptInput,
  MamStartAttemptInput,
  MamSubmitReviewInput
} from '../../../../shared/mam/application-command'
import type {
  MamAttemptDiff,
  MamGetAttemptDiffInput
} from '../../../../shared/mam/attempt-inspection'
import type {
  MamFetchModelCatalogInput,
  MamModelCatalogResult
} from '../../../../shared/mam/model-catalog'
import type { MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import type { MamExportExecutionActivityInput } from '../../../../shared/mam/execution-activity-export'

export type MamSnapshotState = Readonly<{
  snapshot?: MamUiSnapshot
  error?: string
  pending: boolean
  showPending: boolean
  refresh(): Promise<void>
  selectProject(): Promise<void>
  assignTask(input: MamAssignTaskInput): Promise<void>
  reassignTask(input: MamReassignTaskInput): Promise<void>
  recoverAttempt(input: MamRecoverAttemptInput): Promise<void>
  startAttempt(input: MamStartAttemptInput): Promise<void>
  executeNextMerge(input: MamExecuteNextMergeInput): Promise<void>
  saveWorkflow(input: MamSaveWorkflowInput): Promise<void>
  createWorkflowRun(input: MamCreateWorkflowRunInput): Promise<MamUiSnapshot>
  cancelWorkflowRun(input: MamCancelWorkflowRunInput): Promise<void>
  restartWorkflowRun(input: MamRestartWorkflowRunInput): Promise<MamUiSnapshot>
  submitReview(input: MamSubmitReviewInput): Promise<void>
  resolveReviewDisagreement(input: MamResolveReviewDisagreementInput): Promise<void>
  resolveApprovalGate(input: MamResolveApprovalGateInput): Promise<void>
  selectAttempt(input: MamSelectAttemptInput): Promise<void>
  saveProfile(input: MamSaveProfileInput): Promise<void>
  saveLocalSettings(input: MamSaveLocalSettingsInput): Promise<void>
  saveModelConnection(input: MamSaveModelConnectionInput): Promise<void>
  fetchModelCatalog(input: MamFetchModelCatalogInput): Promise<MamModelCatalogResult>
  deleteRoleProfile(input: MamDeleteRoleProfileInput): Promise<void>
  importSkill(): Promise<void>
  exportDiagnostics(): Promise<string | undefined>
  exportExecutionActivity(input: MamExportExecutionActivityInput): Promise<string | undefined>
  getAttemptDiff(input: MamGetAttemptDiffInput): Promise<MamAttemptDiff>
}>
