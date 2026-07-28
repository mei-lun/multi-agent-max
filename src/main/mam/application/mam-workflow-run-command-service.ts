import { randomUUID } from 'node:crypto'
import { MamCreateWorkflowRunInputSchema } from '../../../shared/mam/application-command'
import type { RoleProfile } from '../../../shared/mam/domain/role'
import type { WorkflowDefinition } from '../../../shared/mam/domain/workflow'
import type { MamUiSnapshot } from '../../../shared/mam/ui-projection'
import type { GitStateRepository } from '../state-store/git-state-repository'
import { GitCommandRetryCoordinator } from '../state-store/git-command-retry-coordinator'
import type { MamUiQueryService } from './mam-ui-query-service'
import { createWorkflowRunBundle, createWorkflowRunCommand } from './workflow-run-factory'
import { advanceDeterministicNodes } from './deterministic-node-advancement'

type ReadableRegistry<T> = Readonly<{
  get(id: string, version: number): T | undefined
  listActive(): readonly T[]
  contentHash(profile: T): string
}>

export type MamWorkflowRunCatalog = Readonly<{
  roles: ReadableRegistry<RoleProfile>
  workflows: ReadableRegistry<WorkflowDefinition>
}>

export class MamWorkflowRunCommandServiceError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'MamWorkflowRunCommandServiceError'
  }
}

export class MamWorkflowRunCommandService {
  private repository: GitStateRepository | undefined

  constructor(
    private readonly query: MamUiQueryService,
    private readonly catalog: MamWorkflowRunCatalog,
    private readonly schedulerId: string,
    repository?: GitStateRepository,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly createId: (kind: 'run' | 'command') => string = (kind) =>
      `${kind}.${randomUUID().replaceAll('-', '')}`
  ) {
    this.repository = repository
  }

  setRepository(repository: GitStateRepository): void {
    this.repository = repository
  }

  create(input: unknown): MamUiSnapshot {
    const parsed = MamCreateWorkflowRunInputSchema.parse(input)
    const definition = this.catalog.workflows.get(parsed.definitionId, parsed.definitionVersion)
    if (!definition) {
      throw new MamWorkflowRunCommandServiceError(
        'workflow_definition_not_found',
        `Workflow ${parsed.definitionId} version ${parsed.definitionVersion} was not found`
      )
    }
    const roleIds = referencedRoleIds(definition)
    const roles = this.catalog.roles.listActive().filter((role) => roleIds.has(role.id))
    const missing = [...roleIds].filter((id) => !roles.some((role) => role.id === id))
    if (missing.length > 0) {
      throw new MamWorkflowRunCommandServiceError(
        'active_role_profile_missing',
        `Activate the referenced Role Profiles before starting: ${missing.join(', ')}`
      )
    }
    const createdAt = this.now()
    const bundle = createWorkflowRunBundle({
      runId: this.createId('run'),
      definition,
      roleCatalog: roles.map((role) => ({
        roleProfileId: role.id,
        roleProfileVersion: role.version,
        contentHash: this.catalog.roles.contentHash(role)
      })),
      roleProfiles: roles,
      inputArtifacts: parsed.inputArtifacts,
      createdAt
    })
    const repository = this.requireRepository()
    new GitCommandRetryCoordinator(repository).executeAndPush({
      command: createWorkflowRunCommand({
        bundle,
        commandId: this.createId('command'),
        schedulerId: this.schedulerId,
        issuedAt: createdAt
      }),
      schedulerId: this.schedulerId,
      runBundle: bundle
    })
    advanceDeterministicNodes({
      repository,
      workflowRunId: bundle.run.id,
      schedulerId: this.schedulerId,
      nextCommandId: () => this.createId('command'),
      now: this.now
    })
    return this.query.getSnapshot()
  }

  private requireRepository(): GitStateRepository {
    if (!this.repository) {
      throw new MamWorkflowRunCommandServiceError(
        'project_not_attached',
        'Choose a Git project before starting a Workflow Run'
      )
    }
    return this.repository
  }
}

function referencedRoleIds(definition: WorkflowDefinition): ReadonlySet<string> {
  return new Set(
    definition.nodes.flatMap((node) =>
      'allowedRoleProfileIds' in node
        ? [...node.allowedRoleProfileIds, ...node.recommendedRoleProfileIds]
        : []
    )
  )
}
