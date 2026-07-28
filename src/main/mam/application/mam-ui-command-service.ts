import { randomUUID } from 'node:crypto'
import {
  MamAssignTaskInputSchema,
  MamRecoverAttemptInputSchema,
  MamResolveApprovalGateInputSchema,
  MamSaveLocalSettingsInputSchema,
  MamSaveProfileInputSchema,
  MamSelectAttemptInputSchema,
  MamSaveWorkflowInputSchema
} from '../../../shared/mam/application-command'
import { MamEntityIdSchema } from '../../../shared/mam/domain/primitives'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import type { MamUiSnapshot } from '../../../shared/mam/ui-projection'
import type { WorkflowDefinition } from '../../../shared/mam/domain/workflow'
import { GitCommandRetryCoordinator } from '../state-store/git-command-retry-coordinator'
import type { GitStateRepository } from '../state-store/git-state-repository'
import type { MamUiQueryService } from './mam-ui-query-service'
import { compileWorkflow } from '../workflow/workflow-compiler'
import type { MamLocalSettingsStore } from '../profiles/mam-local-settings-store'
import { validateSkillPackage } from '../skills/skill-package-validator'
import type { MamSkillDefinition } from '../../../shared/mam/domain/skill-definition'
import { submitReviewAndAggregate } from './mam-review-command-service'
import { resolveReviewDisagreementAndPublishMerge } from './mam-review-disagreement-command'
import { advanceDeterministicNodes } from './deterministic-node-advancement'

type CommandPublisher = Readonly<{
  executeAndPush(input: { command: SchedulerCommand; schedulerId: string }): unknown
}>

type WritableRegistry<T = unknown> = Readonly<{
  save(input: unknown): T
  listVersions(id: string): readonly T[]
}>

export type MamUiWritableProfiles = Readonly<{
  roles: WritableRegistry
  executors: WritableRegistry
  providers: WritableRegistry
  models: WritableRegistry
  skills: WritableRegistry<MamSkillDefinition>
  mcpServers: WritableRegistry
  knowledgeBases: WritableRegistry
  workflows: WritableRegistry<WorkflowDefinition>
}>

export type MamUiCommandServiceOptions = Readonly<{
  userId: string
  schedulerId: string
  now?: () => string
  createId?: (kind: 'command' | 'attempt') => string
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
  private commands: CommandPublisher | undefined
  private repository: GitStateRepository | undefined

  constructor(
    private readonly query: MamUiQueryService,
    options: MamUiCommandServiceOptions,
    repository?: GitStateRepository,
    private readonly profiles?: MamUiWritableProfiles,
    private readonly localSettings?: MamLocalSettingsStore
  ) {
    this.userId = MamEntityIdSchema.parse(options.userId)
    this.schedulerId = MamEntityIdSchema.parse(options.schedulerId)
    this.now = options.now ?? (() => new Date().toISOString())
    this.createId = options.createId ?? ((kind) => `${kind}.${randomUUID().replaceAll('-', '')}`)
    if (repository) this.setRepository(repository)
  }

  setRepository(repository: GitStateRepository): void {
    this.repository = repository
    this.commands = new GitCommandRetryCoordinator(repository)
  }

  assignTask(input: unknown): MamUiSnapshot {
    const parsed = MamAssignTaskInputSchema.parse(input)
    this.requireCommands().executeAndPush({
      command: {
        schemaVersion: '1.0.0',
        commandId: this.nextId('command'),
        issuedAt: this.now(),
        workflowRunId: parsed.workflowRunId,
        taskId: parsed.taskId,
        actor: { kind: 'user', userId: this.userId },
        type: 'assign_task',
        roleProfileId: parsed.roleProfileId,
        roleProfileVersion: parsed.roleProfileVersion
      },
      schedulerId: this.schedulerId
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
        actor: { kind: 'scheduler', schedulerId: this.schedulerId },
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
    return this.query.getSnapshot()
  }

  resolveApprovalGate(input: unknown): MamUiSnapshot {
    const parsed = MamResolveApprovalGateInputSchema.parse(input)
    this.requireCommands().executeAndPush({
      command: {
        schemaVersion: '1.0.0',
        commandId: this.nextId('command'),
        issuedAt: this.now(),
        workflowRunId: parsed.workflowRunId,
        actor: { kind: 'user', userId: this.userId },
        type: 'resolve_approval_gate',
        gateId: parsed.gateId,
        option: parsed.option
      },
      schedulerId: this.schedulerId
    })
    advanceDeterministicNodes({
      repository: this.requireRepository(),
      workflowRunId: parsed.workflowRunId,
      schedulerId: this.schedulerId,
      nextCommandId: () => this.nextId('command'),
      now: this.now
    })
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

  async importSkill(sourcePath: string): Promise<MamUiSnapshot> {
    const profiles = this.requireProfiles()
    if (!this.localSettings) {
      throw new MamUiCommandServiceError(
        'local_settings_unavailable',
        'The local Settings store is unavailable'
      )
    }
    const validated = await validateSkillPackage(sourcePath)
    const id = validated.declaredId ?? normalizeSkillId(validated.name)
    const version = profiles.skills.listVersions(id).length + 1
    profiles.skills.save({
      schemaVersion: '1.0.0',
      id,
      version,
      name: validated.name,
      description: validated.description,
      supportedExecutors: validated.supportedExecutors ?? ['codex-cli', 'grok-cli', 'pi-rpc'],
      contentDigest: validated.contentDigest,
      enabled: true,
      importedAt: this.now()
    })
    this.localSettings.upsertSkillBinding({
      id: `binding.${id}`,
      skillId: id,
      sourcePath: validated.canonicalPath,
      bindingIdentity: this.localSettings.get().bindingIdentity
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

function normalizeSkillId(name: string): string {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return MamEntityIdSchema.parse(normalized || 'skill.imported')
}
