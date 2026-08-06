import { randomUUID } from 'node:crypto'
import { MamStartAttemptInputSchema } from '../../../shared/mam/application-command'
import type { MamUiSnapshot } from '../../../shared/mam/ui-projection'
import type { AttemptResourceMaterializer } from '../profiles/attempt-resource-materializer'
import { AttemptConfigResolver } from '../profiles/attempt-config-resolver'
import type { MamLocalSettingsStore } from '../profiles/mam-local-settings-store'
import type { ProfileCatalog } from '../profiles/profile-catalog'
import type { DiagnosticsRecorder } from '../diagnostics/diagnostics-recorder'
import { ExecutorLocalPreflight } from '../executors/executor-local-preflight'
import type { GitStateRepository } from '../state-store/git-state-repository'
import { GitCommandRetryCoordinator } from '../state-store/git-command-retry-coordinator'
import { createGitCommandClient } from '../state-store/git-command-client'
import type { AttemptArtifactValidator } from './attempt-artifact-validator'
import { AttemptWorktreeManager } from './attempt-worktree-manager'
import type { MamUiQueryService } from './mam-ui-query-service'
import {
  EnvironmentAttemptSecretValueProvider,
  type AttemptSecretValueProvider
} from './local-attempt-secrets'
import { resolveSystemPrompt, withHumanInteractionPolicy } from './system-prompt-resolver'
import { launchPreparedAttempt } from './mam-attempt-background-launcher'
import {
  attemptExecutionPrompt,
  conflictAttemptWorktree,
  requireLocalBinding,
  resolveAttemptCredentials,
  resolveExecutableTask
} from './mam-attempt-execution-preparation'
import type { ExecutorRouter, PreparedAttempt } from './mam-attempt-execution-types'
import { profileContentHash } from '../profiles/profile-content-hash'
import { ConflictResolutionWorktreeManager } from './conflict-resolution-worktree-manager'
import type { ExecutorKind } from '../../../shared/mam/domain/execution-profile'
import type { MamAttemptExecutionServiceOptions } from './mam-attempt-execution-service-options'
import { schedulerEnvelope } from './scheduler-envelope'
import { resolveAttemptStartIdentity } from './attempt-start-identity'

export class MamAttemptExecutionService {
  private readonly query: MamUiQueryService
  private readonly catalog: ProfileCatalog
  private readonly settings: MamLocalSettingsStore
  private readonly executor: ExecutorRouter
  private readonly resources: AttemptResourceMaterializer
  private readonly artifacts: AttemptArtifactValidator
  private readonly diagnostics: DiagnosticsRecorder
  private readonly workspaceRoot: string
  private readonly schedulerId: string
  private readonly secretValues: AttemptSecretValueProvider
  private readonly now: () => string
  private readonly createId: (kind: string) => string
  private onStateChanged: () => void
  private readonly preflight: ExecutorLocalPreflight
  private readonly enabledExecutorKinds: ReadonlySet<ExecutorKind> | undefined
  private repository: GitStateRepository | undefined

  constructor(input: MamAttemptExecutionServiceOptions) {
    this.query = input.query
    this.catalog = input.catalog
    this.settings = input.settings
    this.executor = input.executor
    this.resources = input.resources
    this.artifacts = input.artifacts
    this.diagnostics = input.diagnostics
    this.workspaceRoot = input.workspaceRoot
    this.schedulerId = input.schedulerId ?? 'scheduler.desktop'
    this.repository = input.repository
    this.secretValues = input.secretValues ?? new EnvironmentAttemptSecretValueProvider()
    this.now = input.now ?? (() => new Date().toISOString())
    this.createId = input.createId ?? ((kind) => `${kind}.${randomUUID().replaceAll('-', '')}`)
    this.onStateChanged = input.onStateChanged ?? (() => undefined)
    this.preflight = input.preflight ?? new ExecutorLocalPreflight()
    this.enabledExecutorKinds = input.enabledExecutorKinds
      ? new Set(input.enabledExecutorKinds)
      : undefined
  }

  setRepository(repository: GitStateRepository): void {
    this.repository = repository
  }

  setOnStateChanged(onStateChanged: () => void): void {
    this.onStateChanged = onStateChanged
  }

  async start(input: unknown): Promise<MamUiSnapshot> {
    const parsed = MamStartAttemptInputSchema.parse(input)
    const prepared = await this.prepare(parsed.workflowRunId, parsed.taskId)
    try {
      this.publishStart(prepared)
    } catch (error) {
      if (prepared.task.mergeConflictTask) {
        this.conflictWorktrees().abandon({
          repositoryPath: this.requireRepository().projectDirectory,
          integrationRoot: this.workspaceRoot,
          remoteName: this.requireRepository().remote,
          task: prepared.task.mergeConflictTask
        })
      } else {
        this.worktrees().abandon(this.requireRepository().projectDirectory, prepared.worktree)
      }
      throw error
    }
    launchPreparedAttempt(
      {
        prepared,
        executor: this.executor,
        artifacts: this.artifacts,
        worktrees: this.worktrees(),
        conflicts: this.conflictWorktrees(),
        git: createGitCommandClient(this.settings.get().gitExecutable),
        repository: this.requireRepository(),
        diagnostics: this.diagnostics,
        schedulerId: this.schedulerId,
        now: this.now,
        createId: this.createId,
        onActivityChanged: this.onStateChanged
      },
      this.onStateChanged
    )
    return this.query.getSnapshot()
  }

  private async prepare(workflowRunId: string, taskId: string): Promise<PreparedAttempt> {
    const repository = this.requireRepository()
    const projection = repository.rebuild(workflowRunId)
    const bundle = repository.loadRunBundle(workflowRunId)
    if (!bundle) throw new Error('run_bundle_missing')
    const projectedTask = projection.tasks[taskId]
    if (!projectedTask?.roleProfileId || !projectedTask.roleProfileVersion) {
      throw new Error('task_role_assignment_required')
    }
    if (!['ready', 'changes_requested', 'running'].includes(projectedTask.status)) {
      throw new Error(`task_not_startable:${projectedTask.status}`)
    }
    const attemptIdentity = resolveAttemptStartIdentity({
      projection,
      taskId,
      taskStatus: projectedTask.status,
      createAttemptId: () => this.createId('attempt')
    })
    const role =
      bundle.roleProfiles?.find(
        (candidate) =>
          candidate.id === projectedTask.roleProfileId &&
          candidate.version === projectedTask.roleProfileVersion
      ) ?? this.catalog.roles.get(projectedTask.roleProfileId, projectedTask.roleProfileVersion)
    if (!role) throw new Error('frozen_role_profile_unavailable')
    const roleCatalogEntry = bundle.run.roleCatalog.find(
      (entry) => entry.roleProfileId === role.id && entry.roleProfileVersion === role.version
    )
    if (!roleCatalogEntry || roleCatalogEntry.contentHash !== profileContentHash(role)) {
      throw new Error('frozen_role_profile_hash_mismatch')
    }
    const profile = this.catalog.executors.getActive(role.execution.executorProfileId)
    if (!profile) throw new Error('executor_profile_not_found')
    if (this.enabledExecutorKinds && !this.enabledExecutorKinds.has(profile.kind)) {
      throw new Error(`executor_not_enabled:${profile.kind}`)
    }
    const settings = this.settings.get()
    const binding = requireLocalBinding(
      settings.executorBindings.filter(
        (candidate) =>
          candidate.executorProfileId === profile.id &&
          candidate.bindingIdentity === settings.bindingIdentity
      ),
      'local_executor_binding'
    )
    const preflight = this.preflight.check(profile, binding)
    if (!preflight.ok) throw new Error(preflight.issues.map((issue) => issue.message).join('; '))
    const attemptId = attemptIdentity.attemptId
    const task = resolveExecutableTask(bundle, projection, taskId, projectedTask.status)
    const createdAt = this.now()
    const resolved = await new AttemptConfigResolver(this.catalog).resolve({
      workflowRunId,
      taskId,
      attemptId,
      roleProfileId: role.id,
      roleProfileVersion: role.version,
      roleProfile: role,
      capabilities: preflight.capabilities,
      localSecretBindings: settings.secretBindings.filter(
        (candidate) => candidate.bindingIdentity === settings.bindingIdentity
      ),
      localSkillBindings: settings.skillBindings.filter(
        (candidate) => candidate.bindingIdentity === settings.bindingIdentity
      ),
      localKnowledgeBindings: settings.knowledgeBindings.filter(
        (candidate) => candidate.bindingIdentity === settings.bindingIdentity
      ),
      createdAt,
      workspaceMode: task.workspaceMode
    })
    const credentialValues = resolveAttemptCredentials(
      resolved.snapshot.execution.providerSecretRef,
      settings.secretBindings,
      settings.bindingIdentity,
      this.secretValues
    )
    const materialized = await this.resources.materialize(resolved)
    const systemPrompt = withHumanInteractionPolicy(
      resolveSystemPrompt(role.systemPromptRef, repository.projectDirectory)
    )
    const worktree = task.mergeConflictTask
      ? conflictAttemptWorktree(
          this.conflictWorktrees().prepare({
            repositoryPath: repository.projectDirectory,
            integrationRoot: this.workspaceRoot,
            remoteName: repository.remote,
            task: task.mergeConflictTask
          }),
          task.mergeConflictTask
        )
      : this.worktrees().prepare({
          repositoryPath: repository.projectDirectory,
          workspaceRoot: this.workspaceRoot,
          remoteName: repository.remote,
          attemptId,
          baseRef: task.baseRef
        })
    const roleInstanceId = this.createId('role-instance')
    const executorInvocationId = this.createId('executor-invocation')
    return {
      workflowRunId,
      taskId,
      attemptId,
      ...(attemptIdentity.previousAttemptId
        ? { previousAttemptId: attemptIdentity.previousAttemptId }
        : {}),
      roleInstanceId,
      executorInvocationId,
      retryMaxAttempts: role.retry.maxAttempts,
      nodeId: task.nodeId,
      task,
      profile,
      binding,
      snapshot: resolved.snapshot,
      resources: materialized,
      resolvedConfig: resolved,
      mcpConnections: settings.mcpConnections,
      credentialValues,
      systemPrompt,
      prompt: attemptExecutionPrompt(task, worktree.branch),
      worktree
    }
  }

  private publishStart(prepared: PreparedAttempt): void {
    const coordinator = new GitCommandRetryCoordinator(this.requireRepository())
    const issuedAt = this.now()
    coordinator.executeAndPush({
      command: {
        ...schedulerEnvelope(prepared, this.createId('command'), issuedAt, this.schedulerId),
        type: 'announce_execution',
        claimId: this.createId('claim'),
        attemptId: prepared.attemptId,
        ...(prepared.previousAttemptId ? { previousAttemptId: prepared.previousAttemptId } : {}),
        executorInstanceId: this.createId('executor-instance')
      },
      schedulerId: this.schedulerId
    })
    coordinator.executeAndPush({
      command: {
        ...schedulerEnvelope(prepared, this.createId('command'), issuedAt, this.schedulerId),
        type: 'start_attempt',
        attemptId: prepared.attemptId,
        roleInstanceId: prepared.roleInstanceId,
        executorInvocationId: prepared.executorInvocationId,
        effectiveConfigSnapshotId: prepared.snapshot.id,
        effectiveConfigHash: prepared.snapshot.contentHash
      },
      schedulerId: this.schedulerId,
      effectiveConfigSnapshot: prepared.snapshot
    })
    this.record(prepared, 'scheduler', { status: 'attempt_started' })
  }

  private worktrees(): AttemptWorktreeManager {
    return new AttemptWorktreeManager(createGitCommandClient(this.settings.get().gitExecutable))
  }

  private conflictWorktrees(): ConflictResolutionWorktreeManager {
    return new ConflictResolutionWorktreeManager(
      createGitCommandClient(this.settings.get().gitExecutable)
    )
  }

  private record(
    prepared: PreparedAttempt,
    kind: 'scheduler' | 'executor',
    payload: Readonly<Record<string, unknown>>
  ): void {
    this.diagnostics.record({
      at: this.now(),
      workflowRunId: prepared.workflowRunId,
      nodeId: prepared.nodeId,
      roleInstanceId: prepared.roleInstanceId,
      executorInvocationId: prepared.executorInvocationId,
      kind,
      payload
    })
  }

  private requireRepository(): GitStateRepository {
    if (!this.repository) throw new Error('project_not_attached')
    return this.repository
  }
}
