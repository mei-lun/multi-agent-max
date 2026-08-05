import { describe, expect, it, vi } from 'vitest'
import type { MamUiWritableProfiles } from './mam-profile-write-ports'
import { deactivateRoleProfile, deactivateWorkflow } from './profile-deactivation-command'

describe('Profile deactivation commands', () => {
  it('deactivates the requested Role and Workflow identities', () => {
    const roles = registry()
    const workflows = registry()
    const profiles = profileCatalog(roles, workflows)
    const createError = (code: string, message: string) =>
      Object.assign(new Error(message), { code })

    deactivateRoleProfile({ roleProfileId: 'role.builder' }, profiles, createError)
    deactivateWorkflow({ definitionId: 'workflow.delivery' }, profiles, createError)

    expect(roles.deactivate).toHaveBeenCalledWith('role.builder')
    expect(workflows.deactivate).toHaveBeenCalledWith('workflow.delivery')
  })
})

function registry() {
  return {
    save: vi.fn((input: unknown) => input),
    listVersions: vi.fn(() => []),
    deactivate: vi.fn()
  }
}

function profileCatalog(
  roles: ReturnType<typeof registry>,
  workflows: ReturnType<typeof registry>
): MamUiWritableProfiles {
  const other = registry()
  return {
    roles,
    workflows,
    executors: other,
    providers: other,
    models: other,
    skills: other,
    mcpServers: other,
    knowledgeBases: other
  } as unknown as MamUiWritableProfiles
}
