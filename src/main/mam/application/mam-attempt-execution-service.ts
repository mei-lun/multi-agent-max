import { randomUUID } from 'node:crypto'; import { join } from 'node:path'
import { MamStartAttemptInputSchema } from '../../../shared/mam/application-command'
import type { MamUiSnapshot } from '../../../shared/mam/ui-projection'
import type { AttemptResourceMaterializer } from '../profiles/attempt-resource-materializer'; import { AttemptConfigResolver } from '../profiles/attempt-config-resolver'
import type { MamLocalSettingsStore } from '../profiles/mam-local-settings-store'; import type { ProfileCatalog } from '../profiles/profile-catalog'
import type { DiagnosticsRecorder } from '../diagnostics/diagnostics-recorder'
import { ExecutorLocalPreflight } from '../executors/executor-local-preflight'
import type { GitStateRepository } from '../state-store/git-state-repository'; import { createGitCommandClient } from '../state-store/git-command-client'
import type { AttemptArtifactValidator } from './attempt-artifact-validator'; import { AttemptWorktreeManager } from './attempt-worktree-manager'
import type { MamUiQueryService } from './mam-ui-query-service'
import { EnvironmentAttemptSecretValueProvider, type AttemptSecretValueProvider } from './local-attempt-secrets'
import { resolveSystemPrompt, withHumanInteractionPolicy } from './system-prompt-resolver'; import { launchPreparedAttempt } from './mam-attempt-background-launcher'
import { attemptExecutionPrompt, conflictAttemptWorktree, requireLocalBinding, resolveExecutionCredentials, resolveExecutableTask } from './mam-attempt-execution-preparation'
import type { ExecutorRouter, PreparedAttempt } from './mam-attempt-execution-types'; import { profileContentHash } from '../profiles/profile-content-hash'
import { ConflictResolutionWorktreeManager } from './conflict-resolution-worktree-manager'
import type { ExecutorKind } from '../../../shared/mam/domain/execution-profile'
import type { MamAttemptExecutionServiceOptions } from './mam-attempt-execution-service-options'; import { resolveAttemptStartIdentity } from './attempt-start-identity'
import { LocalTaskExecutionRegistry } from './local-task-execution-registry'
import { createIntegrationAncestryResolver } from './attempt-integration-ancestry'
import { nextFormalRevisionNumber } from '../review/review-revision-counter'
import { claimPreparedAttempt } from './attempt-task-claim'
import { abandonPreparedAttempt } from './abandon-prepared-attempt'
import { LocalExecutionDraftStore } from './local-execution-draft-store'
import { recordPreparedAttemptRunning } from './prepared-attempt-draft'
import { continuePreparedAttempt } from './pi-session-continuation'
import type { LocalExecutionDraft } from '../../../shared/mam/local-execution-draft'
import { preparedAttemptMatchesActiveClaim, recoverableDraftForActiveClaim, restoredAttemptIdentity, restoredExecutionContext, restoredPreparedFields, restoredWorktree } from './local-execution-draft-restore'
import { discardSupersededLocalDrafts } from './superseded-local-draft-discard'

export class MamAttemptExecutionService {
  private readonly query: MamUiQueryService; private readonly catalog: ProfileCatalog; private readonly settings: MamLocalSettingsStore; private readonly executor: ExecutorRouter
  private readonly resources: AttemptResourceMaterializer; private readonly artifacts: AttemptArtifactValidator; private readonly diagnostics: DiagnosticsRecorder; private readonly workspaceRoot: string
  private readonly schedulerId: string; private readonly claimantInstanceId: string; private readonly secretValues: AttemptSecretValueProvider; private readonly now: () => string
  private readonly createId: (kind: string) => string; private onStateChanged: () => void; private readonly preflight: ExecutorLocalPreflight; private readonly drafts: LocalExecutionDraftStore
  private readonly enabledExecutorKinds: ReadonlySet<ExecutorKind> | undefined
  private readonly localTaskExecutions = new LocalTaskExecutionRegistry<MamUiSnapshot>(); private readonly preparedDrafts = new Map<string, PreparedAttempt>(); private repository: GitStateRepository | undefined

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
    this.claimantInstanceId = input.claimantInstanceId ?? `claimant.${randomUUID().replaceAll('-', '')}`
    this.repository = input.repository
    this.secretValues = input.secretValues ?? new EnvironmentAttemptSecretValueProvider()
    this.now = input.now ?? (() => new Date().toISOString())
    this.createId = input.createId ?? ((kind) => `${kind}.${randomUUID().replaceAll('-', '')}`)
    this.onStateChanged = input.onStateChanged ?? (() => undefined)
    this.preflight = input.preflight ?? new ExecutorLocalPreflight()
    this.enabledExecutorKinds = input.enabledExecutorKinds && new Set(input.enabledExecutorKinds)
    this.drafts = input.drafts ?? new LocalExecutionDraftStore(join(this.workspaceRoot, 'drafts'))
  }

  setRepository(repository: GitStateRepository): void { this.repository = repository }

  async start(input: unknown): Promise<MamUiSnapshot> {
    const parsed = MamStartAttemptInputSchema.parse(input)
    const key = [this.requireRepository().stateDirectory, parsed.workflowRunId, parsed.taskId].join(
      '\0'
    )
    return this.localTaskExecutions.getOrCreate(key, async () => {
      let prepared: PreparedAttempt | undefined
      try {
        const retainedCandidate = this.preparedDrafts.get(key)
        const activeClaim = this.requireRepository().rebuild(parsed.workflowRunId).tasks[
          parsed.taskId
        ]?.activeClaim
        discardSupersededLocalDrafts({ store: this.drafts, worktrees: this.worktrees(), repositoryPath: this.requireRepository().projectDirectory, workflowRunId: parsed.workflowRunId, taskId: parsed.taskId, activeClaim, claimantInstanceId: this.claimantInstanceId })
        const retained = preparedAttemptMatchesActiveClaim(
          retainedCandidate,
          activeClaim,
          this.claimantInstanceId
        )
          ? retainedCandidate
          : undefined
        if (retainedCandidate && !retained) this.preparedDrafts.delete(key)
        const unfinished = recoverableDraftForActiveClaim({ drafts: this.drafts.listUnfinished(), workflowRunId: parsed.workflowRunId, taskId: parsed.taskId, activeClaim, claimantInstanceId: this.claimantInstanceId })
        if (unfinished?.state === 'needs_attention' && !parsed.resumeNeedsAttention) {
          throw new Error('local_draft_needs_attention')
        }
        const persisted = unfinished
        const retainedDraft = retained?.draftId ? this.drafts.get(retained.draftId) : undefined
        if (retainedDraft?.state === 'needs_attention' && !parsed.resumeNeedsAttention) {
          throw new Error('local_draft_needs_attention')
        }
        const local = retained
          ? continuePreparedAttempt(retained, this.drafts, this.createId('executor-invocation'))
          : await this.prepare(parsed.workflowRunId, parsed.taskId, persisted)
        prepared = local
        prepared = claimPreparedAttempt(
          prepared,
          this.requireRepository(),
          this.claimantInstanceId,
          this.schedulerId,
          this.createId,
          this.now()
        )
        prepared = { ...prepared, draftId: `draft.${prepared.attemptId}` }
        recordPreparedAttemptRunning(this.drafts, prepared, this.now())
        this.preparedDrafts.set(key, prepared)
      } catch (error) {
        this.localTaskExecutions.release(key)
        if (prepared)
          abandonPreparedAttempt({
            prepared,
            repository: this.requireRepository(),
            worktrees: this.worktrees(),
            conflicts: this.conflictWorktrees(),
            workspaceRoot: this.workspaceRoot
          })
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
          onActivityChanged: this.onStateChanged,
          drafts: this.drafts
        },
        () => {
          this.localTaskExecutions.release(key)
          if (prepared.draftId && this.drafts.get(prepared.draftId)?.state === 'delivered') {
            this.preparedDrafts.delete(key)
          }
          this.onStateChanged()
        }
      )
      return this.query.getSnapshot()
    }, () => this.query.getSnapshot())
  }

  private async prepare(
    workflowRunId: string,
    taskId: string,
    persisted?: LocalExecutionDraft
  ): Promise<PreparedAttempt> {
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
    const attemptIdentity = persisted
      ? restoredAttemptIdentity(persisted)
      : resolveAttemptStartIdentity({
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
    const frozen = persisted ? restoredExecutionContext(persisted) : undefined
    const profile = frozen?.profile ?? this.catalog.executors.getActive(role.execution.executorProfileId)
    if (!profile) throw new Error('executor_profile_not_found')
    if (this.enabledExecutorKinds && !this.enabledExecutorKinds.has(profile.kind)) {
      throw new Error(`executor_not_enabled:${profile.kind}`)
    }
    const settings = this.settings.get()
    const binding =
      frozen?.binding ??
      requireLocalBinding(
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
    const git = createGitCommandClient(settings.gitExecutable)
    const task = resolveExecutableTask(
      bundle,
      projection,
      taskId,
      projectedTask.status,
      createIntegrationAncestryResolver({
        git,
        repositoryPath: repository.projectDirectory,
        remoteName: repository.remote
      })
    )
    const createdAt = persisted?.createdAt ?? this.now()
    const resolved =
      frozen?.resolvedConfig ??
      (await new AttemptConfigResolver(this.catalog).resolve({
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
      }))
    const { providerCredentials: credentialValues, mcpCredentials: mcpCredentialValues } =
      resolveExecutionCredentials({ resolved, settings, provider: this.secretValues })
    const materialized = frozen?.resources ?? (await this.resources.materialize(resolved))
    const systemPrompt = withHumanInteractionPolicy(
      resolveSystemPrompt(role.systemPromptRef, repository.projectDirectory)
    )
    const worktree = persisted
      ? restoredWorktree(persisted)
      : task.mergeConflictTask
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
            baseRef: task.baseRef,
            ...(task.baseBranch ? { baseBranch: task.baseBranch } : {})
          })
    const roleInstanceId = persisted?.roleInstanceId ?? this.createId('role-instance'); const restoredFields = persisted ? restoredPreparedFields(persisted, Boolean(task.reviewTask)) : undefined
    return {
      workflowRunId,
      taskId,
      attemptId,
      ...(attemptIdentity.previousAttemptId
        ? { previousAttemptId: attemptIdentity.previousAttemptId }
        : {}),
      ...(restoredFields
        ? restoredFields
        : {
            claimId: 'claim.pending',
            claimGeneration: 1,
            formalRevisionNumber: nextFormalRevisionNumber(
              attemptIdentity.previousAttemptId,
              projection.attempts
            ),
            roleInstanceId,
            prompt: attemptExecutionPrompt(task, worktree.branch)
          }),
      executorInvocationId:
        restoredFields?.executorInvocationId ?? this.createId('executor-invocation'),
      retryMaxAttempts: role.retry.maxAttempts,
      nodeId: task.nodeId,
      task,
      profile,
      binding,
      snapshot: resolved.snapshot,
      resources: materialized,
      resolvedConfig: resolved,
      mcpConnections: settings.mcpConnections,
      mcpCredentialValues,
      credentialValues,
      systemPrompt,
      worktree
    }
  }

  private worktrees(): AttemptWorktreeManager { return new AttemptWorktreeManager(createGitCommandClient(this.settings.get().gitExecutable)) }

  private conflictWorktrees(): ConflictResolutionWorktreeManager { return new ConflictResolutionWorktreeManager(createGitCommandClient(this.settings.get().gitExecutable)) }

  private requireRepository(): GitStateRepository { if (!this.repository) throw new Error('project_not_attached'); return this.repository }
}
