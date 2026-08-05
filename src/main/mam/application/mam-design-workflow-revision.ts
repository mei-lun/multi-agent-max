import type { MamDesignWorkflowRevision } from '../../../shared/mam/design-assistant'
import type { ProfileCatalog } from '../profiles/profile-catalog'

export function createMamDesignWorkflowRevision(
  profiles: ProfileCatalog,
  workflowId: string,
  baseVersion: number
): MamDesignWorkflowRevision {
  const latestVersion = profiles.workflows
    .listVersions(workflowId)
    .reduce((latest, workflow) => Math.max(latest, workflow.version), baseVersion)
  return { workflowId, baseVersion, nextVersion: latestVersion + 1 }
}
