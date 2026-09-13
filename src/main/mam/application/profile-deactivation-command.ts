import {
  MamDeleteRoleProfileInputSchema,
  MamDeleteExecutionProfileInputSchema,
  MamDeleteWorkflowInputSchema
} from '../../../shared/mam/application-command'
import type { MamUiWritableProfiles } from './mam-profile-write-ports'
import type { MamUiSnapshot } from '../../../shared/mam/ui-projection'
import { executionProfileReferences } from '../../../shared/mam/execution-profile-removal'

export function deactivateExecutionProfile(
  input: unknown,
  profiles: MamUiWritableProfiles,
  snapshot: MamUiSnapshot,
  createError: (code: string, message: string) => Error
): void {
  const parsed = MamDeleteExecutionProfileInputSchema.parse(input)
  const references = executionProfileReferences(snapshot, parsed)
  if (references.length)
    throw createError('profile_in_use', `Profile is still used by: ${references.join(', ')}`)
  const registry =
    parsed.kind === 'executor'
      ? profiles.executors
      : parsed.kind === 'provider'
        ? profiles.providers
        : profiles.models
  deactivateProfile(registry, parsed.profileId, parsed.kind, createError)
}

export function deactivateRoleProfile(
  input: unknown,
  profiles: MamUiWritableProfiles,
  createError: (code: string, message: string) => Error
): void {
  const parsed = MamDeleteRoleProfileInputSchema.parse(input)
  deactivateProfile(profiles.roles, parsed.roleProfileId, 'Role Profile', createError)
}

export function deactivateWorkflow(
  input: unknown,
  profiles: MamUiWritableProfiles,
  createError: (code: string, message: string) => Error
): void {
  const parsed = MamDeleteWorkflowInputSchema.parse(input)
  deactivateProfile(profiles.workflows, parsed.definitionId, 'Workflow Profile', createError)
}

function deactivateProfile(
  registry: Readonly<{ deactivate?(id: string): void }>,
  id: string,
  profileName: string,
  createError: (code: string, message: string) => Error
): void {
  if (!registry.deactivate) {
    throw createError(
      'profile_catalog_unavailable',
      `The ${profileName} catalog cannot delete profiles`
    )
  }
  registry.deactivate(id)
}
