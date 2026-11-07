import type { AttemptResourceMaterializer } from '../profiles/attempt-resource-materializer'
import { AttemptConfigResolver } from '../profiles/attempt-config-resolver'
import type { MamLocalSettingsStore } from '../profiles/mam-local-settings-store'
import type { ProfileCatalog } from '../profiles/profile-catalog'
import type { ExecutorLocalPreflight } from '../executors/executor-local-preflight'
import type { GitStateRepository } from '../state-store/git-state-repository'
import { createGitCommandClient } from '../state-store/git-command-client'
import type { AttemptArtifactValidator } from './attempt-artifact-validator'
import type { AttemptWorktreeManager } from './attempt-worktree-manager'
import { type AttemptSecretValueProvider } from './local-attempt-secrets'
import { resolveSystemPrompt, withHumanInteractionPolicy } from './system-prompt-resolver'
import {
  attemptExecutionPrompt,
  conflictAttemptWorktree,
  requireLocalBinding,
  resolveExecutionCredentials,
  resolveExecutableTask
} from './mam-attempt-execution-preparation'
import type { PreparedAttempt } from './mam-attempt-execution-types'
import { profileContentHash } from '../profiles/profile-content-hash'
import type { ConflictResolutionWorktreeManager } from './conflict-resolution-worktree-manager'
import type { ExecutorKind } from '../../../shared/mam/domain/execution-profile'
import { resolveAttemptStartIdentity } from './attempt-start-identity'
import { createIntegrationAncestryResolver } from './attempt-integration-ancestry'
import { nextFormalRevisionNumber } from '../review/review-revision-counter'
import type { LocalExecutionDraft } from '../../../shared/mam/local-execution-draft'
import {
  restoredAttemptIdentity,
  restoredExecutionContext,
  restoredPreparedFields,
  restoredWorktree
} from './local-execution-draft-restore'
import { componentHostCapabilities, type ComponentExecutionPort } from './component-execution-port'
import type { ComponentToolPortFactory } from './component-tool-port'

export type AttemptPreparationContext = {
  requireRepository(): GitStateRepository
  createId(kind: string): string
  catalog: ProfileCatalog
  componentExecutor: ComponentExecutionPort | undefined
  enabledExecutorKinds: ReadonlySet<ExecutorKind> | undefined
  settings: MamLocalSettingsStore
  workspaceRoot: string
  preflight: ExecutorLocalPreflight
  now(): string
  componentTools: ComponentToolPortFactory | undefined
  artifacts: AttemptArtifactValidator
  secretValues: AttemptSecretValueProvider
  resources: AttemptResourceMaterializer
  conflictWorktrees(): ConflictResolutionWorktreeManager
  worktrees(): AttemptWorktreeManager
}
export async function prepareExecutableAttempt(
  context: AttemptPreparationContext,
  workflowRunId: string,
  taskId: string,
  persisted?: LocalExecutionDraft
): Promise<PreparedAttempt> {
  const repository = context.requireRepository()
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
        createAttemptId: () => context.createId('attempt')
      })
  const role =
    bundle.roleProfiles?.find(
      (candidate) =>
        candidate.id === projectedTask.roleProfileId &&
        candidate.version === projectedTask.roleProfileVersion
    ) ?? context.catalog.roles.get(projectedTask.roleProfileId, projectedTask.roleProfileVersion)
  if (!role) throw new Error('frozen_role_profile_unavailable')
  const roleCatalogEntry = bundle.run.roleCatalog.find(
    (entry) => entry.roleProfileId === role.id && entry.roleProfileVersion === role.version
  )
  if (!roleCatalogEntry || roleCatalogEntry.contentHash !== profileContentHash(role)) {
    throw new Error('frozen_role_profile_hash_mismatch')
  }
  const frozen = persisted ? restoredExecutionContext(persisted) : undefined
  const component = bundle.taskCatalog.find((candidate) => candidate.id === taskId)?.component
  if (component && !context.componentExecutor) throw new Error('component_executor_unavailable')
  if (component && persisted) throw new Error('component_reconciliation_required')
  if (component && !role.tools.includes(`component:${component.id}`))
    throw new Error('component_permission_denied')
  const profile =
    frozen?.profile ?? context.catalog.executors.getActive(role.execution.executorProfileId)
  if (!profile) throw new Error('executor_profile_not_found')
  if (
    !component &&
    context.enabledExecutorKinds &&
    !context.enabledExecutorKinds.has(profile.kind)
  ) {
    throw new Error(`executor_not_enabled:${profile.kind}`)
  }
  const settings = context.settings.get()
  const binding =
    frozen?.binding ??
    (component
      ? {
          id: 'binding.component-host',
          executorProfileId: profile.id,
          executablePath: 'component-host-not-an-executable',
          configRoot: context.workspaceRoot,
          bindingIdentity: settings.bindingIdentity
        }
      : requireLocalBinding(
          settings.executorBindings.filter(
            (candidate) =>
              candidate.executorProfileId === profile.id &&
              candidate.bindingIdentity === settings.bindingIdentity
          ),
          'local_executor_binding'
        ))
  const preflight = component
    ? { ok: true as const, capabilities: componentHostCapabilities }
    : context.preflight.check(profile, binding)
  if (!preflight.ok) throw new Error(preflight.issues.map((issue) => issue.message).join('; '))
  const attemptId = attemptIdentity.attemptId
  const git = createGitCommandClient(settings.gitExecutable)
  let task = resolveExecutableTask(
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
  const createdAt = persisted?.createdAt ?? context.now()
  if (
    component ||
    (context.componentTools && role.tools.some((tool) => tool.startsWith('component:')))
  )
    task = {
      ...task,
      inputArtifacts: [
        ...(await context.artifacts.authorizeComponentInputs(bundle, projection, task))
      ]
    }
  const resolved =
    frozen?.resolvedConfig ??
    (await new AttemptConfigResolver(context.catalog).resolve({
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
      workspaceMode: task.workspaceMode,
      ...(component ? { componentExecution: true } : {})
    }))
  const { providerCredentials: credentialValues, mcpCredentials: mcpCredentialValues } =
    resolveExecutionCredentials({ resolved, settings, provider: context.secretValues })
  const materialized = frozen?.resources ?? (await context.resources.materialize(resolved))
  const systemPrompt = withHumanInteractionPolicy(
    resolveSystemPrompt(role.systemPromptRef, repository.projectDirectory)
  )
  const worktree = persisted
    ? restoredWorktree(persisted)
    : task.mergeConflictTask
      ? conflictAttemptWorktree(
          context.conflictWorktrees().prepare({
            repositoryPath: repository.projectDirectory,
            integrationRoot: context.workspaceRoot,
            remoteName: repository.remote,
            task: task.mergeConflictTask
          }),
          task.mergeConflictTask
        )
      : context.worktrees().prepare({
          repositoryPath: repository.projectDirectory,
          workspaceRoot: context.workspaceRoot,
          remoteName: repository.remote,
          attemptId,
          baseRef: task.baseRef,
          ...(task.baseBranch ? { baseBranch: task.baseBranch } : {})
        })
  const roleInstanceId = persisted?.roleInstanceId ?? context.createId('role-instance')
  const restoredFields = persisted
    ? restoredPreparedFields(persisted, Boolean(task.reviewTask))
    : undefined
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
      restoredFields?.executorInvocationId ?? context.createId('executor-invocation'),
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
