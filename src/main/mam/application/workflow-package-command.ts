import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { RoleProfile } from '../../../shared/mam/domain/role'
import type { WorkflowDefinition } from '../../../shared/mam/domain/workflow'
import {
  createMamWorkflowPackage,
  MamExportWorkflowPackageInputSchema,
  MamWorkflowPackageSchema,
  workflowRoleProfileIds,
  type MamWorkflowPackage
} from '../../../shared/mam/workflow-package'
import type { MamUiWritableProfiles } from './mam-profile-write-ports'

export function exportWorkflowPackage(
  input: unknown,
  destinationPath: string,
  profiles: MamUiWritableProfiles,
  createError: (code: string, message: string) => Error
): string {
  const parsed = MamExportWorkflowPackageInputSchema.parse(input)
  const workflow = findVersion<WorkflowDefinition>(
    profiles.workflows,
    parsed.definitionId,
    parsed.definitionVersion
  )
  if (!workflow) {
    throw createError(
      'workflow_version_not_found',
      `${parsed.definitionId} version ${parsed.definitionVersion} does not exist`
    )
  }
  const roles = workflowRoleProfileIds(workflow).map((roleId) => {
    const role = findVersion<RoleProfile>(
      profiles.roles,
      roleId,
      activeVersion(profiles.roles, roleId, createError)
    )
    if (!role) {
      throw createError(
        'workflow_role_missing',
        `Workflow ${workflow.id} references Role ${roleId}, but that version is unavailable`
      )
    }
    return role
  })
  const pack = createMamWorkflowPackage(workflow, roles)
  const path = resolve(destinationPath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(pack, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  return path
}

export function importWorkflowPackage(
  sourcePath: string,
  profiles: MamUiWritableProfiles,
  createError: (code: string, message: string) => Error
): void {
  let pack: MamWorkflowPackage
  try {
    pack = MamWorkflowPackageSchema.parse(JSON.parse(readFileSync(resolve(sourcePath), 'utf8')))
  } catch (error) {
    throw createError(
      'workflow_package_invalid',
      error instanceof Error ? error.message : String(error)
    )
  }
  for (const roleId of workflowRoleProfileIds(pack.workflow)) {
    if (!pack.roles.some((role) => role.id === roleId)) {
      throw createError(
        'workflow_role_missing',
        `Workflow ${pack.workflow.id} references missing Role ${roleId}`
      )
    }
  }
  for (const role of pack.roles) saveImportedProfile(profiles.roles, role)
  saveImportedProfile(profiles.workflows, pack.workflow)
}

function findVersion<T extends { id: string; version: number }>(
  registry: {
    get?(id: string, version: number): unknown
    listVersions(id: string): readonly unknown[]
  },
  id: string,
  version: number
): T | undefined {
  const direct = registry.get?.(id, version)
  if (isVersionedProfile<T>(direct)) return direct
  return registry
    .listVersions(id)
    .find((entry): entry is T => isVersionedProfile<T>(entry) && entry.version === version)
}

function activeVersion(
  registry: { listActive?: () => readonly unknown[]; listVersions(id: string): readonly unknown[] },
  id: string,
  createError: (code: string, message: string) => Error
): number {
  const active = registry
    .listActive?.()
    .find(
      (entry): entry is { id: string; version: number } =>
        isVersionedProfile(entry) && entry.id === id
    )
  if (active) return active.version
  const latest = registry.listVersions(id).at(-1)
  if (!isVersionedProfile(latest)) {
    throw createError('workflow_role_missing', `Role ${id} is unavailable`)
  }
  return latest.version
}

function saveImportedProfile<T extends { id: string; version: number }>(
  registry: {
    save(input: unknown): unknown
    listVersions(id: string): readonly unknown[]
    activate?(id: string, version: number): unknown
  },
  profile: T
): T {
  const existing = registry
    .listVersions(profile.id)
    .find((entry): entry is T => isVersionedProfile<T>(entry) && entry.version === profile.version)
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(profile)) {
      const nextVersion =
        Math.max(
          ...registry
            .listVersions(profile.id)
            .filter(isVersionedProfile)
            .map((entry) => entry.version),
          0
        ) + 1
      return registry.save({ ...profile, version: nextVersion }) as T
    }
    registry.activate?.(profile.id, profile.version)
    return existing
  }
  return registry.save(profile) as T
}

function isVersionedProfile<T extends { id: string; version: number }>(value: unknown): value is T {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === 'object' &&
    'id' in value &&
    typeof value.id === 'string' &&
    'version' in value &&
    typeof value.version === 'number'
  )
}
