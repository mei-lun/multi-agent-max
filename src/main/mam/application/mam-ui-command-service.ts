import { randomUUID } from 'node:crypto'
import {
  MamAssignTaskInputSchema,
  MamRecoverAttemptInputSchema,
  MamReassignTaskInputSchema,
  MamSaveLocalSettingsInputSchema,
  MamSaveProfileInputSchema,
  MamSelectAttemptInputSchema,
  MamSaveWorkflowInputSchema
} from '../../../shared/mam/application-command'
import { MamEntityIdSchema } from '../../../shared/mam/domain/primitives'
import type { MamUiSnapshot } from '../../../shared/mam/ui-projection'
import { GitCommandRetryCoordinator } from '../state-store/git-command-retry-coordinator'
import type { GitStateRepository } from '../state-store/git-state-repository'
import type { MamUiQueryService } from './mam-ui-query-service'
import { compileWorkflow } from '../workflow/workflow-compiler'
import type { MamLocalSettingsStore } from '../profiles/mam-local-settings-store'
import { submitReviewAndAggregate } from './mam-review-command-service'
import { resolveReviewDisagreementAndPublishMerge } from './mam-review-disagreement-command'
import { saveModelConnectionProfiles } from './model-connection-command'
import { MamProviderModelCatalogService } from './provider-model-catalog'
import { importSkillProfile } from './skill-import-command'
import type { MamLocalSecretWriter, MamUiWritableProfiles } from './mam-profile-write-ports'
import type { MamModelCatalogResult } from '../../../shared/mam/model-catalog'
import { publishTaskAssignmentCommand } from './task-assignment-command'
import {
  resolveApprovalGateAndPublishDelivery,
  type CommandPublisher
} from './approval-gate-delivery-command'
import {
  exportWorkflowPackage as writeWorkflowPackage,
  importWorkflowPackage as readWorkflowPackage
} from './workflow-package-command'
import {
  deactivateRoleProfile,
  deactivateWorkflow as deactivateWorkflowProfile
} from './profile-deactivation-command'

export type MamUiCommandServiceOptions = Readonly<{
  userId: string
  schedulerId: string
  now?: () => string
  createId?: (kind: 'command' | 'attempt') => string
  onStateChanged?: () => void
}>

export class MamUiCommandServiceError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'MamUiCommandServiceError'
  }
}

export class MamUiCommandService {
  private readonly userId: string
  private readonly schedulerId: string
  private readonly now: () => string
  private readonly createId: (kind: 'command' | 'attempt') => string
  private onStateChanged: () => void
  private commands: CommandPublisher | undefined
  private repository: GitStateRepository | undefined

  constructor(
    private readonly query: MamUiQueryService,
    options: MamUiCommandServiceOptions,
    repository?: GitStateRepository,
    private readonly profiles?: MamUiWritableProfiles,
    private readonly localSettings?: MamLocalSettingsStore,
    private readonly localSecrets?: MamLocalSecretWriter,
    private readonly modelCatalog = new MamProviderModelCatalogService()
  ) {
    this.userId = MamEntityIdSchema.parse(options.userId)
    this.schedulerId = MamEntityIdSchema.parse(options.schedulerId)
    this.now = options.now ?? (() => new Date().toISOString())
    this.createId = options.createId ?? ((kind) => `${kind}.${randomUUID().replaceAll('-', '')}`)
    this.onStateChanged = options.onStateChanged ?? (() => undefined)
    if (repository) this.setRepository(repository)
  }

  setRepository(repository: GitStateRepository): void {
    this.repository = repository
    this.commands = new GitCommandRetryCoordinator(repository)
  }

  setOnStateChanged(onStateChanged: () => void): void {
    this.onStateChanged = onStateChanged
  }

  assignTask(input: unknown): MamUiSnapshot {
    const parsed = MamAssignTaskInputSchema.parse(input)
    publishTaskAssignmentCommand({
      request: parsed,
      type: 'assign_task',
      userId: this.userId,
      schedulerId: this.schedulerId,
      commandId: this.nextId('command'),
      issuedAt: this.now(),
      publisher: this.requireCommands()
    })
    return this.query.getSnapshot()
  }

  reassignTask(input: unknown): MamUiSnapshot {
    const parsed = MamReassignTaskInputSchema.parse(input)
    publishTaskAssignmentCommand({
      request: parsed,
      type: 'reassign_task',
      userId: this.userId,
      schedulerId: this.schedulerId,
      commandId: this.nextId('command'),
      issuedAt: this.now(),
      publisher: this.requireCommands()
    })
    return this.query.getSnapshot()
  }

  recoverAttempt(input: unknown): MamUiSnapshot {
    const parsed = MamRecoverAttemptInputSchema.parse(input)
    const directive =
      parsed.resolution === 'start_new_attempt'
        ? { kind: 'start_new_attempt' as const, newAttemptId: this.nextId('attempt') }
        : { kind: 'needs_reconciliation' as const }
    this.requireCommands().executeAndPush({
      command: {
        schemaVersion: '1.0.0',
        commandId: this.nextId('command'),
        issuedAt: this.now(),
        workflowRunId: parsed.workflowRunId,
        taskId: parsed.taskId,
        actor: { kind: 'user', userId: this.userId },
        type: 'recover_attempt',
        previousAttemptId: parsed.previousAttemptId,
        directive,
        reason: parsed.reason
      },
      schedulerId: this.schedulerId
    })
    return this.query.getSnapshot()
  }

  saveWorkflow(input: unknown): MamUiSnapshot {
    const parsed = MamSaveWorkflowInputSchema.parse(input)
    compileWorkflow(parsed.definition)
    if (!this.profiles) {
      throw new MamUiCommandServiceError(
        'profile_catalog_unavailable',
        'The Workflow Profile catalog is unavailable'
      )
    }
    this.profiles.workflows.save(parsed.definition)
    return this.query.getSnapshot()
  }

  submitReview(input: unknown): MamUiSnapshot {
    submitReviewAndAggregate({
      request: input,
      repository: this.requireRepository(),
      schedulerId: this.schedulerId,
      nextCommandId: () => this.nextId('command'),
      now: this.now
    })
    this.onStateChanged()
    return this.query.getSnapshot()
  }

  resolveReviewDisagreement(input: unknown): MamUiSnapshot {
    resolveReviewDisagreementAndPublishMerge({
      request: input,
      repository: this.requireRepository(),
      schedulerId: this.schedulerId,
      userId: this.userId,
      nextCommandId: () => this.nextId('command'),
      now: this.now
    })
    this.onStateChanged()
    return this.query.getSnapshot()
  }

  resolveApprovalGate(input: unknown): MamUiSnapshot {
    resolveApprovalGateAndPublishDelivery({
      request: input,
      repository: this.requireRepository(),
      commands: this.requireCommands(),
      schedulerId: this.schedulerId,
      userId: this.userId,
      nextCommandId: () => this.nextId('command'),
      now: this.now
    })
    this.onStateChanged()
    return this.query.getSnapshot()
  }

  selectAttempt(input: unknown): MamUiSnapshot {
    const parsed = MamSelectAttemptInputSchema.parse(input)
    this.requireCommands().executeAndPush({
      command: {
        schemaVersion: '1.0.0',
        commandId: this.nextId('command'),
        issuedAt: this.now(),
        workflowRunId: parsed.workflowRunId,
        taskId: parsed.taskId,
        actor: { kind: 'user', userId: this.userId },
        type: 'select_attempt',
        attemptId: parsed.attemptId
      },
      schedulerId: this.schedulerId
    })
    return this.query.getSnapshot()
  }

  saveProfile(input: unknown): MamUiSnapshot {
    const parsed = MamSaveProfileInputSchema.parse(input)
    const profiles = this.requireProfiles()
    const registries = {
      role: profiles.roles,
      executor: profiles.executors,
      provider: profiles.providers,
      model: profiles.models,
      skill: profiles.skills,
      mcp: profiles.mcpServers,
      knowledge: profiles.knowledgeBases
    } as const
    registries[parsed.kind].save(parsed.profile)
    return this.query.getSnapshot()
  }

  saveLocalSettings(input: unknown): MamUiSnapshot {
    const parsed = MamSaveLocalSettingsInputSchema.parse(input)
    if (!this.localSettings) {
      throw new MamUiCommandServiceError(
        'local_settings_unavailable',
        'The local Settings store is unavailable'
      )
    }
    this.localSettings.save(parsed.settings)
    return this.query.getSnapshot()
  }

  saveModelConnection(input: unknown): MamUiSnapshot {
    saveModelConnectionProfiles(
      input,
      this.requireProfiles(),
      this.localSettings,
      this.localSecrets
    )
    return this.query.getSnapshot()
  }

  fetchModelCatalog(input: unknown): Promise<MamModelCatalogResult> {
    return this.modelCatalog.fetch(input)
  }

  deleteRoleProfile(input: unknown): MamUiSnapshot {
    deactivateRoleProfile(input, this.requireProfiles(), makeCommandError)
    return this.query.getSnapshot()
  }

  deleteWorkflow(input: unknown): MamUiSnapshot {
    deactivateWorkflowProfile(input, this.requireProfiles(), makeCommandError)
    return this.query.getSnapshot()
  }

  exportWorkflowPackage(input: unknown, destinationPath: string): string {
    return writeWorkflowPackage(input, destinationPath, this.requireProfiles(), makeCommandError)
  }

  importWorkflowPackage(sourcePath: string): MamUiSnapshot {
    readWorkflowPackage(sourcePath, this.requireProfiles(), makeCommandError)
    return this.query.getSnapshot()
  }

  async importSkill(sourcePath: string): Promise<MamUiSnapshot> {
    const profiles = this.requireProfiles()
    if (!this.localSettings) {
      throw new MamUiCommandServiceError(
        'local_settings_unavailable',
        'The local Settings store is unavailable'
      )
    }
    await importSkillProfile({
      sourcePath,
      profiles,
      localSettings: this.localSettings,
      now: this.now
    })
    return this.query.getSnapshot()
  }

  private requireCommands(): CommandPublisher {
    if (!this.commands) {
      throw new MamUiCommandServiceError(
        'project_not_attached',
        'Choose a Git project before changing workflow state'
      )
    }
    return this.commands
  }

  private requireRepository(): GitStateRepository {
    if (!this.repository) {
      throw new MamUiCommandServiceError('project_not_attached', 'Choose a Git project first')
    }
    return this.repository
  }

  private requireProfiles(): MamUiWritableProfiles {
    if (!this.profiles) {
      throw new MamUiCommandServiceError(
        'profile_catalog_unavailable',
        'The Profile catalog is unavailable'
      )
    }
    return this.profiles
  }

  private nextId(kind: 'command' | 'attempt'): string {
    return MamEntityIdSchema.parse(this.createId(kind))
  }
}

function makeCommandError(code: string, message: string): MamUiCommandServiceError {
  return new MamUiCommandServiceError(code, message)
}
