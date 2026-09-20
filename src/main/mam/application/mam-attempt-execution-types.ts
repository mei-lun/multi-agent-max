import type { ExecutorProfile } from '../../../shared/mam/domain/execution-profile'
import type { StaticTaskDefinition } from '../../../shared/mam/domain/run-bundle'
import type {
  StructuredExecutorInput,
  StructuredExecutorResult
} from '../executors/structured-executor-router'
import type { AttemptWorktree } from './attempt-worktree-manager'
import type { LocalExecutionDraftStore } from './local-execution-draft-store'
import type { MergeConflictTaskDefinition } from '../../../shared/mam/domain/merge-conflict-task'
import type { McpLocalConnection } from '../../../shared/mam/domain/resource-profile'
import type { ResolvedAttemptConfig } from '../profiles/attempt-config-resolver'
import type { ReviewTaskDefinition } from '../../../shared/mam/domain/review'

export type AttemptInputArtifactContext = Readonly<{
  artifactType: string
  source: 'workflow' | 'external'
  expectedHash: string
  producerNodeId?: string
  producerTaskId?: string
  producerAttemptId?: string
  sourceCommit?: string
  contentLocations: readonly string[]
}>

export type AttemptIntegrationBase = Readonly<{
  mergeNodeId: string
  targetBranch: string
  mergeCommit: string
}>

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
  baseBranch?: string
  inputArtifactContext?: readonly AttemptInputArtifactContext[]
  inputDeliveries?: readonly Readonly<{ taskId: string; attemptId: string }>[]
  integrationBase?: AttemptIntegrationBase
  nodeType?: StaticTaskDefinition['nodeType']
  reviewTask?: ReviewTaskDefinition
  mergeConflictTask?: MergeConflictTaskDefinition
  revisionFeedback?: string
}>

export type PreparedAttempt = Readonly<{
  workflowRunId: string
  taskId: string
  attemptId: string
  previousAttemptId?: string
  claimId: string
  claimGeneration: number
  formalRevisionNumber: number
  roleInstanceId: string
  executorInvocationId: string
  retryMaxAttempts?: number
  nodeId: string
  task: ExecutableAttemptTask
  profile: ExecutorProfile
  binding: StructuredExecutorInput['binding']
  snapshot: StructuredExecutorInput['snapshot']
  resources: StructuredExecutorInput['resources']
  resolvedConfig: ResolvedAttemptConfig
  mcpConnections: readonly McpLocalConnection[]
  mcpCredentialValues?: Readonly<Record<string, string>>
  credentialValues: Readonly<Record<string, string>>
  systemPrompt: string
  prompt: string
  worktree: AttemptWorktree
  draftId?: string
  resumeSessionFile?: string
  recoveredAssistantText?: string
}>

export type AttemptDraftStore = LocalExecutionDraftStore
