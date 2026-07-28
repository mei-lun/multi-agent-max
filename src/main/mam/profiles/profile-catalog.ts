import { join, resolve } from 'node:path'
import {
  ExecutorProfileSchema,
  ModelProfileSchema,
  ProviderProfileSchema
} from '../../../shared/mam/domain/execution-profile'
import {
  KnowledgeBaseProfileSchema,
  McpServerProfileSchema
} from '../../../shared/mam/domain/resource-profile'
import { RoleProfileSchema } from '../../../shared/mam/domain/role'
import { MamSkillDefinitionSchema } from '../../../shared/mam/domain/skill-definition'
import { WorkflowDefinitionSchema } from '../../../shared/mam/domain/workflow'
import { VersionedProfileRegistry } from './versioned-profile-registry'

export class ProfileCatalog {
  readonly roles
  readonly executors
  readonly providers
  readonly models
  readonly skills
  readonly mcpServers
  readonly knowledgeBases
  readonly workflows

  constructor(rootDirectory: string) {
    const root = resolve(rootDirectory)
    this.roles = new VersionedProfileRegistry(join(root, 'roles'), RoleProfileSchema)
    this.executors = new VersionedProfileRegistry(join(root, 'executors'), ExecutorProfileSchema)
    this.providers = new VersionedProfileRegistry(join(root, 'providers'), ProviderProfileSchema)
    this.models = new VersionedProfileRegistry(join(root, 'models'), ModelProfileSchema)
    this.skills = new VersionedProfileRegistry(join(root, 'skills'), MamSkillDefinitionSchema)
    this.mcpServers = new VersionedProfileRegistry(join(root, 'mcp'), McpServerProfileSchema)
    this.knowledgeBases = new VersionedProfileRegistry(
      join(root, 'knowledge-bases'),
      KnowledgeBaseProfileSchema
    )
    this.workflows = new VersionedProfileRegistry(
      join(root, 'definitions'),
      WorkflowDefinitionSchema
    )
  }
}
