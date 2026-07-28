import type { ExecutorProfile } from '../../../shared/mam/domain/execution-profile'
import type { StaticTaskDefinition } from '../../../shared/mam/domain/run-bundle'
import type {
  StructuredExecutorInput,
  StructuredExecutorResult
} from '../executors/structured-executor-router'
import type { AttemptWorktree } from './attempt-worktree-manager'
import type { MergeConflictTaskDefinition } from '../../../shared/mam/domain/merge-conflict-task'

export type ExecutorRouter = Readonly<{
  execute(input: StructuredExecutorInput): Promise<StructuredExecutorResult>
}>

export type ExecutableAttemptTask = Readonly<{
  nodeRunId: string
  nodeId: string
  specification: string
  inputArtifacts: StaticTaskDefinition['inputArtifacts']
  outputContracts: StaticTaskDefinition['outputContracts']
  workspaceMode: 'none' | 'read' | 'write'
  baseRef: string
  nodeType?: StaticTaskDefinition['nodeType']
  mergeConflictTask?: MergeConflictTaskDefinition
}>

export type PreparedAttempt = Readonly<{
  workflowRunId: string
  taskId: string
  attemptId: string
  previousAttemptId?: string
  roleInstanceId: string
  executorInvocationId: string
  nodeId: string
  task: ExecutableAttemptTask
  profile: ExecutorProfile
  binding: StructuredExecutorInput['binding']
  snapshot: StructuredExecutorInput['snapshot']
  resources: StructuredExecutorInput['resources']
  credentialValues: Readonly<Record<string, string>>
  systemPrompt: string
  prompt: string
  worktree: AttemptWorktree
}>
