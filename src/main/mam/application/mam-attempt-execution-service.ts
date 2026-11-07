import { prepareExecutableAttempt } from './prepare-executable-attempt'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { MamStartAttemptInputSchema } from '../../../shared/mam/application-command'
import type { MamUiSnapshot } from '../../../shared/mam/ui-projection'
import type { AttemptResourceMaterializer } from '../profiles/attempt-resource-materializer'
import type { MamLocalSettingsStore } from '../profiles/mam-local-settings-store'
import type { ProfileCatalog } from '../profiles/profile-catalog'
import type { DiagnosticsRecorder } from '../diagnostics/diagnostics-recorder'
import { ExecutorLocalPreflight } from '../executors/executor-local-preflight'
import type { GitStateRepository } from '../state-store/git-state-repository'
import { createGitCommandClient } from '../state-store/git-command-client'
import type { AttemptArtifactValidator } from './attempt-artifact-validator'
import { AttemptWorktreeManager } from './attempt-worktree-manager'
import type { MamUiQueryService } from './mam-ui-query-service'
import {
  EnvironmentAttemptSecretValueProvider,
  type AttemptSecretValueProvider
} from './local-attempt-secrets'
import { launchPreparedAttempt } from './mam-attempt-background-launcher'
import type { ExecutorRouter, PreparedAttempt } from './mam-attempt-execution-types'
import { ConflictResolutionWorktreeManager } from './conflict-resolution-worktree-manager'
import type { ExecutorKind } from '../../../shared/mam/domain/execution-profile'
import type { MamAttemptExecutionServiceOptions } from './mam-attempt-execution-service-options'
import { LocalTaskExecutionRegistry } from './local-task-execution-registry'
import { claimPreparedAttempt } from './attempt-task-claim'
import { abandonPreparedAttempt } from './abandon-prepared-attempt'
import { LocalExecutionDraftStore } from './local-execution-draft-store'
import { recordPreparedAttemptRunning } from './prepared-attempt-draft'
import { continuePreparedAttempt } from './pi-session-continuation'
import type { LocalExecutionDraft } from '../../../shared/mam/local-execution-draft'
import {
  preparedAttemptMatchesActiveClaim,
  recoverableDraftForActiveClaim
} from './local-execution-draft-restore'
import { discardSupersededLocalDrafts } from './superseded-local-draft-discard'
import { resumeAutomaticExecutionDrafts } from './automatic-draft-resume'
import { requireLocalConnectionRetryDecision } from './local-connection-retry-guard'
import { type ComponentExecutionPort } from './component-execution-port'
import type { ComponentToolPortFactory } from './component-tool-port'

export class MamAttemptExecutionService {
  private readonly componentExecutor: ComponentExecutionPort | undefined
  private readonly componentTools: ComponentToolPortFactory | undefined
  private readonly query: MamUiQueryService
  private readonly catalog: ProfileCatalog
  private readonly settings: MamLocalSettingsStore
  private readonly executor: ExecutorRouter
  private readonly resources: AttemptResourceMaterializer
  private readonly artifacts: AttemptArtifactValidator
  private readonly diagnostics: DiagnosticsRecorder
  private readonly workspaceRoot: string
  private readonly schedulerId: string
  private readonly claimantInstanceId: string
  private readonly secretValues: AttemptSecretValueProvider
  private readonly now: () => string
  private readonly createId: (kind: string) => string
  private onStateChanged: () => void
  private readonly preflight: ExecutorLocalPreflight
  private readonly drafts: LocalExecutionDraftStore
  private readonly enabledExecutorKinds: ReadonlySet<ExecutorKind> | undefined
  private readonly localTaskExecutions = new LocalTaskExecutionRegistry<MamUiSnapshot>()
  private readonly preparedDrafts = new Map<string, PreparedAttempt>()
  private repository: GitStateRepository | undefined
  private readonly automaticallyResumedDraftIds = new Set<string>()

  constructor(input: MamAttemptExecutionServiceOptions) {
    this.query = input.query
    this.catalog = input.catalog
    this.settings = input.settings
    this.executor = input.executor
    this.componentExecutor = input.componentExecutor
    this.componentTools = input.componentTools
    this.resources = input.resources
    this.artifacts = input.artifacts
    this.diagnostics = input.diagnostics
    this.workspaceRoot = input.workspaceRoot
    this.schedulerId = input.schedulerId ?? 'scheduler.desktop'
    this.claimantInstanceId =
      input.claimantInstanceId ?? `claimant.${randomUUID().replaceAll('-', '')}`
    this.repository = input.repository
    this.secretValues = input.secretValues ?? new EnvironmentAttemptSecretValueProvider()
    this.now = input.now ?? (() => new Date().toISOString())
    this.createId = input.createId ?? ((kind) => `${kind}.${randomUUID().replaceAll('-', '')}`)
    this.onStateChanged = input.onStateChanged ?? (() => undefined)
    this.preflight = input.preflight ?? new ExecutorLocalPreflight()
    this.enabledExecutorKinds = input.enabledExecutorKinds && new Set(input.enabledExecutorKinds)
    this.drafts = input.drafts ?? new LocalExecutionDraftStore(join(this.workspaceRoot, 'drafts'))
  }

  setRepository(repository: GitStateRepository): void {
    this.repository = repository
  }

  async resumeAutomaticDrafts(): Promise<void> {
    await resumeAutomaticExecutionDrafts({
      repository: this.repository,
      settings: this.settings,
      drafts: this.drafts,
      claimantInstanceId: this.claimantInstanceId,
      resumedDraftIds: this.automaticallyResumedDraftIds,
      start: (next) => this.start(next),
      onStateChanged: this.onStateChanged
    })
  }

  async start(input: unknown): Promise<MamUiSnapshot> {
    const parsed = MamStartAttemptInputSchema.parse(input)
    const key = [this.requireRepository().stateDirectory, parsed.workflowRunId, parsed.taskId].join(
      '\0'
    )
    return this.localTaskExecutions.getOrCreate(
      key,
      async () => {
        let prepared: PreparedAttempt | undefined
        try {
          const retainedCandidate = this.preparedDrafts.get(key)
          const activeClaim = this.requireRepository().rebuild(parsed.workflowRunId).tasks[
            parsed.taskId
          ]?.activeClaim
          discardSupersededLocalDrafts({
            store: this.drafts,
            worktrees: this.worktrees(),
            repositoryPath: this.requireRepository().projectDirectory,
            workflowRunId: parsed.workflowRunId,
            taskId: parsed.taskId,
            activeClaim,
            claimantInstanceId: this.claimantInstanceId
          })
          const retained = preparedAttemptMatchesActiveClaim(
            retainedCandidate,
            activeClaim,
            this.claimantInstanceId
          )
            ? retainedCandidate
            : undefined
          if (retainedCandidate && !retained) this.preparedDrafts.delete(key)
          const unfinished = recoverableDraftForActiveClaim({
            drafts: this.drafts.listUnfinished(),
            workflowRunId: parsed.workflowRunId,
            taskId: parsed.taskId,
            activeClaim,
            claimantInstanceId: this.claimantInstanceId
          })
          requireLocalConnectionRetryDecision(unfinished, parsed.resumeNeedsAttention)
          if (unfinished?.state === 'needs_attention' && !parsed.resumeNeedsAttention)
            throw new Error('local_draft_needs_attention')
          const persisted = unfinished
          const retainedDraft = retained?.draftId ? this.drafts.get(retained.draftId) : undefined
          if (retained?.task.component) throw new Error('component_reconciliation_required')
          requireLocalConnectionRetryDecision(retainedDraft, parsed.resumeNeedsAttention)
          if (retainedDraft?.state === 'needs_attention' && !parsed.resumeNeedsAttention)
            throw new Error('local_draft_needs_attention')
          prepared = retained
            ? continuePreparedAttempt(retained, this.drafts, this.createId('executor-invocation'))
            : await this.prepare(parsed.workflowRunId, parsed.taskId, persisted)
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
            ...(this.componentTools ? { componentTools: this.componentTools } : {}),
            ...(this.componentExecutor ? { componentExecutor: this.componentExecutor } : {}),
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
            if (prepared!.draftId && this.drafts.get(prepared!.draftId)?.state === 'delivered')
              this.preparedDrafts.delete(key)
            this.onStateChanged()
          }
        )
        return this.query.getSnapshot()
      },
      () => this.query.getSnapshot()
    )
  }

  private prepare(
    workflowRunId: string,
    taskId: string,
    persisted?: LocalExecutionDraft
  ): Promise<PreparedAttempt> {
    return prepareExecutableAttempt(
      {
        requireRepository: () => this.requireRepository(),
        createId: this.createId,
        catalog: this.catalog,
        componentExecutor: this.componentExecutor,
        enabledExecutorKinds: this.enabledExecutorKinds,
        settings: this.settings,
        workspaceRoot: this.workspaceRoot,
        preflight: this.preflight,
        now: this.now,
        componentTools: this.componentTools,
        artifacts: this.artifacts,
        secretValues: this.secretValues,
        resources: this.resources,
        conflictWorktrees: () => this.conflictWorktrees(),
        worktrees: () => this.worktrees()
      },
      workflowRunId,
      taskId,
      persisted
    )
  }

  private worktrees(): AttemptWorktreeManager {
    return new AttemptWorktreeManager(createGitCommandClient(this.settings.get().gitExecutable))
  }

  private conflictWorktrees(): ConflictResolutionWorktreeManager {
    return new ConflictResolutionWorktreeManager(
      createGitCommandClient(this.settings.get().gitExecutable)
    )
  }

  private requireRepository(): GitStateRepository {
    if (!this.repository) throw new Error('project_not_attached')
    return this.repository
  }
}
