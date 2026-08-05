import type {
  MamDesignValidationIssue,
  MamDesignWorkflowRevision
} from '../../../shared/mam/design-assistant'
import type { WorkflowDefinition } from '../../../shared/mam/domain/workflow'
import type { ProfileCatalog } from '../profiles/profile-catalog'

export function validateMamDesignWorkflowIdentity(input: {
  workflow: WorkflowDefinition
  profiles: ProfileCatalog
  workflowRevision?: MamDesignWorkflowRevision
}): MamDesignValidationIssue[] {
  const revision = input.workflowRevision
  if (!revision) return validateNewWorkflowId(input.workflow, input.profiles)
  const issues: MamDesignValidationIssue[] = []
  if (
    input.workflow.id !== revision.workflowId ||
    input.workflow.version !== revision.nextVersion
  ) {
    issues.push({
      code: 'workflow_revision_identity_changed',
      severity: 'error',
      path: 'workflow',
      message: `Workflow revision must remain ${revision.workflowId} version ${revision.nextVersion}`
    })
  }
  const active = input.profiles.workflows.getActive(revision.workflowId)
  if (!active || active.version !== revision.baseVersion) {
    issues.push({
      code: 'workflow_revision_stale',
      severity: 'error',
      path: 'workflow.version',
      message: `Workflow ${revision.workflowId} changed after this draft started`
    })
  }
  if (input.profiles.workflows.get(revision.workflowId, revision.nextVersion)) {
    issues.push({
      code: 'workflow_revision_version_exists',
      severity: 'error',
      path: 'workflow.version',
      message: `Workflow ${revision.workflowId} version ${revision.nextVersion} already exists`
    })
  }
  return issues
}

function validateNewWorkflowId(
  workflow: WorkflowDefinition,
  profiles: ProfileCatalog
): MamDesignValidationIssue[] {
  if (profiles.workflows.listVersions(workflow.id).length === 0) return []
  return [
    {
      code: 'workflow_id_exists',
      severity: 'error',
      path: 'workflow.id',
      message: `Workflow ID already exists: ${workflow.id}`
    }
  ]
}
