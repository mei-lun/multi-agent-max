import {
  MamDeleteRoleProfileInputSchema,
  MamDeleteWorkflowInputSchema
} from '../../../shared/mam/application-command'
import type { MamUiWritableProfiles } from './mam-profile-write-ports'

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
