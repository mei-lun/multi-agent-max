import type { DiagnosticsRecorder } from '../diagnostics/diagnostics-recorder'
import type { GitStateRepository } from '../state-store/git-state-repository'
import type { AttemptArtifactValidator } from './attempt-artifact-validator'
import type { AttemptWorktreeManager } from './attempt-worktree-manager'
import type { ConflictResolutionWorktreeManager } from './conflict-resolution-worktree-manager'
import type { GitCommandClient } from '../state-store/git-command-client'
import type {
  ComponentExecutionPort,
  ComponentToolPortFactory,
  ExecutorRouter,
  PreparedAttempt
} from './mam-attempt-execution-types'
import type { LocalExecutionDraftStore } from './local-execution-draft-store'
export type PreparedAttemptRunnerInput = Readonly<{
  prepared: PreparedAttempt
  executor: ExecutorRouter
  componentExecutor?: ComponentExecutionPort
  componentTools?: ComponentToolPortFactory
  artifacts: AttemptArtifactValidator
  worktrees: AttemptWorktreeManager
  conflicts: ConflictResolutionWorktreeManager
  git: GitCommandClient
  repository: GitStateRepository
  diagnostics: DiagnosticsRecorder
  schedulerId: string
  now(): string
  createId(kind: string): string
  onActivityChanged?(): void
  drafts?: LocalExecutionDraftStore
}>
