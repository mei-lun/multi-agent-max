import type { RoleProfile } from '../../../shared/mam/domain/role'
import type { WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'
import type { WorkflowDefinition } from '../../../shared/mam/domain/workflow'
import type {
  ExecutorProfile,
  ModelProfile,
  ProviderProfile
} from '../../../shared/mam/domain/execution-profile'
import type {
  KnowledgeBaseProfile,
  McpServerProfile
} from '../../../shared/mam/domain/resource-profile'
import type { MamSkillDefinition } from '../../../shared/mam/domain/skill-definition'
import { defaultMamLocalSettings, type MamLocalSettings } from '../../../shared/mam/local-settings'
import {
  MamUiSnapshotSchema,
  type MamUiRunSnapshot,
  type MamUiSnapshot
} from '../../../shared/mam/ui-projection'
import type { WorkflowRunProjection } from '../state-store/git-state-projection'
import type { DiagnosticsRecorder } from '../diagnostics/diagnostics-recorder'
import { projectWorkflowRun } from './workflow-run-projection'
import { reviewDisagreementResolution } from './review-disagreement-resolution'
import {
  indexAttemptInterruptions,
  projectAttemptInterruption,
  type AttemptInterruptionIndex
} from './attempt-interruption-projection'
import { projectBinding } from './mam-ui-project-binding'
import { collectMamUiTaskDefinitions } from './mam-ui-task-definitions'

type ActiveRegistry<T> = Readonly<{ listActive(): readonly T[] }>

export type MamUiProfileSource = Readonly<{
  roles: ActiveRegistry<RoleProfile>
  workflows: ActiveRegistry<WorkflowDefinition>
  executors?: ActiveRegistry<ExecutorProfile>
  providers?: ActiveRegistry<ProviderProfile>
  models?: ActiveRegistry<ModelProfile>
  skills?: ActiveRegistry<MamSkillDefinition>
  mcpServers?: ActiveRegistry<McpServerProfile>
  knowledgeBases?: ActiveRegistry<KnowledgeBaseProfile>
  localSettings?: Readonly<{ get(): MamLocalSettings }>
}>

export type MamUiRunSource = Readonly<{
  listWorkflowRunIds(): readonly string[]
  loadRunBundle(workflowRunId: string): WorkflowRunBundle | undefined
  rebuild(workflowRunId: string): WorkflowRunProjection
  projectDirectory?: string
  stateDirectory?: string
  remote?: string | undefined
  collaborationMode?: 'local' | 'distributed'
  branch?: string
}>

export class MamUiQueryService {
  constructor(
    private readonly profiles: MamUiProfileSource,
    private runs: MamUiRunSource | undefined,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly diagnostics?: Pick<DiagnosticsRecorder, 'list'> &
      Partial<Pick<DiagnosticsRecorder, 'listInterruptionEvents'>>
  ) {}

  setRunSource(runs: MamUiRunSource): void {
    this.runs = runs
  }

  getSnapshot(): MamUiSnapshot {
    const generatedAt = this.now()
    const interruptions = indexAttemptInterruptions(
      this.diagnostics?.listInterruptionEvents?.() ?? this.diagnostics?.list() ?? []
    )
    const runSnapshots: MamUiRunSnapshot[] = []
    const issues: MamUiSnapshot['issues'][number][] = []
    for (const workflowRunId of this.runs?.listWorkflowRunIds() ?? []) {
      try {
        const bundle = this.runs!.loadRunBundle(workflowRunId)
        if (!bundle) {
          issues.push({
            code: 'run_bundle_missing',
            workflowRunId,
            message: 'Run Bundle is missing from authoritative Git state'
          })
          continue
        }
        runSnapshots.push(
          createRunSnapshot(bundle, this.runs!.rebuild(workflowRunId), generatedAt, interruptions)
        )
      } catch (error) {
        issues.push({
          code: errorCode(error),
          workflowRunId,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }
    return MamUiSnapshotSchema.parse({
      schemaVersion: '1.0.0',
      generatedAt,
      roles: this.profiles.roles.listActive(),
      executors: this.profiles.executors?.listActive() ?? [],
      providers: this.profiles.providers?.listActive() ?? [],
      models: this.profiles.models?.listActive() ?? [],
      skills: this.profiles.skills?.listActive() ?? [],
      mcpServers: this.profiles.mcpServers?.listActive() ?? [],
      knowledgeBases: this.profiles.knowledgeBases?.listActive() ?? [],
      workflows: this.profiles.workflows.listActive(),
      localSettings: this.profiles.localSettings?.get() ?? defaultMamLocalSettings(),
      ...projectBinding(this.runs),
      runs: runSnapshots.sort((left, right) => left.run.id.localeCompare(right.run.id)),
      issues
    })
  }
}

function createRunSnapshot(
  bundle: WorkflowRunBundle,
  projection: WorkflowRunProjection,
  generatedAt: string,
  interruptions: AttemptInterruptionIndex
): MamUiRunSnapshot {
  const application = projectWorkflowRun(bundle, projection, generatedAt)
  const taskDefinitions = collectMamUiTaskDefinitions(bundle, projection)
  return {
    run: application.run,
    definitionName: bundle.definition.name,
    roleProfiles: [...(bundle.roleProfiles ?? [])],
    revision: projection.revision,
    stateHash: projection.stateHash,
    nodeRuns: [...application.nodeRuns],
    readyTaskIds: [...application.readyTaskIds],
    approvalGates: bundle.definition.nodes
      .filter((node) => node.type === 'approval_gate')
      .map((node) => ({
        id: node.id,
        prompt: node.prompt,
        options: node.options,
        status: projection.resolvedApprovalGates[node.id]
          ? ('resolved' as const)
          : ('pending' as const),
        ...(projection.resolvedApprovalGates[node.id]
          ? { selectedOption: projection.resolvedApprovalGates[node.id]!.option }
          : {})
      })),
    tasks: [...new Set([...taskDefinitions.keys(), ...Object.keys(projection.tasks)])]
      .sort((left, right) => left.localeCompare(right))
      .map((id) => {
        const task = projection.tasks[id]
        const definition = taskDefinitions.get(id)
        return {
          id,
          title: definition?.title ?? id,
          ...(definition?.specification ? { specification: definition.specification } : {}),
          inputArtifacts: [...(definition?.inputArtifacts ?? [])],
          outputContracts: [...(definition?.outputContracts ?? [])],
          kind: definition?.kind ?? 'unknown',
          status:
            task?.status ??
            (application.readyTaskIds.includes(id)
              ? 'waiting_role_assignment'
              : (definition?.initialStatus ?? 'waiting_dependencies')),
          ...(task?.roleProfileId ? { roleProfileId: task.roleProfileId } : {}),
          ...(task?.roleProfileVersion ? { roleProfileVersion: task.roleProfileVersion } : {}),
          ...(task?.assignedByUserId ? { assignedByUserId: task.assignedByUserId } : {}),
          dependencies: [...(definition?.dependencies ?? [])],
          recommendedRoleProfileIds: [...(definition?.recommendedRoleProfileIds ?? [])],
          allowedRoleProfileIds: [...(definition?.allowedRoleProfileIds ?? [])],
          attemptIds: [...(task?.knownAttemptIds ?? [])],
          ...(task?.selectedAttemptId ? { selectedAttemptId: task.selectedAttemptId } : {}),
          ...(definition?.reviewSubject ? { reviewSubject: definition.reviewSubject } : {}),
          reviewIds: [...(task?.reviewIds ?? [])],
          executionWarningCount: task?.executionWarnings.length ?? 0
        }
      }),
    attempts: Object.entries(projection.attempts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, attempt]) => {
        const interruption = projectAttemptInterruption(bundle.run.id, attempt, interruptions)
        return {
          id,
          taskId: attempt.taskId,
          ...(attempt.previousAttemptId ? { previousAttemptId: attempt.previousAttemptId } : {}),
          status: attempt.status,
          ...(attempt.roleInstanceId ? { roleInstanceId: attempt.roleInstanceId } : {}),
          ...(attempt.effectiveConfigHash
            ? { effectiveConfigHash: attempt.effectiveConfigHash }
            : {}),
          ...(interruption ? { interruption } : {}),
          ...(attempt.result ? { result: attempt.result } : {})
        }
      }),
    reviews: sortCreatedAt(Object.values(projection.reviews)),
    reviewAggregations: sortCreatedAt(Object.values(projection.reviewAggregations)),
    reviewDisagreementResolutions: Object.values(projection.reviewAggregations).flatMap(
      (aggregation) => {
        const resolution = reviewDisagreementResolution(aggregation, projection)
        return resolution ? [resolution] : []
      }
    ),
    mergeQueueEntries: Object.values(projection.mergeQueueEntries).sort(compareMergeEntries),
    mergeConflictTasks: sortCreatedAt(Object.values(projection.mergeConflictTasks)),
    mergeConflictResolutions: sortCompletedAt(Object.values(projection.mergeConflictResolutions))
  }
}

function sortCreatedAt<T extends Readonly<{ id: string; createdAt: string }>>(
  values: readonly T[]
): T[] {
  return [...values].sort(
    (left, right) => left.createdAt.localeCompare(right.createdAt) || compareIds(left, right)
  )
}

function sortCompletedAt<T extends Readonly<{ id: string; completedAt: string }>>(
  values: readonly T[]
): T[] {
  return [...values].sort(
    (left, right) => left.completedAt.localeCompare(right.completedAt) || compareIds(left, right)
  )
}

function compareMergeEntries(
  left: WorkflowRunProjection['mergeQueueEntries'][string],
  right: WorkflowRunProjection['mergeQueueEntries'][string]
): number {
  return (
    left.mergeReadyAt.localeCompare(right.mergeReadyAt) ||
    left.taskId.localeCompare(right.taskId) ||
    left.id.localeCompare(right.id)
  )
}

function compareIds(left: Readonly<{ id: string }>, right: Readonly<{ id: string }>): number {
  return left.id.localeCompare(right.id)
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code
  }
  return 'ui_projection_failed'
}
