import type {
  MamDesignProposal,
  MamDesignWorkflowRevision
} from '../../../shared/mam/design-assistant'
import type { ProfileCatalog } from '../profiles/profile-catalog'
import { validateMamDesignProposal } from './mam-design-proposal-validation'

type StagedDefinition = Readonly<{
  id: string
  version: number
  registry: ProfileCatalog['roles'] | ProfileCatalog['workflows']
  previousVersion?: number
}>

export class MamDesignProposalWriterError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'MamDesignProposalWriterError'
  }
}

export function writeMamDesignProposal(
  proposal: MamDesignProposal,
  profiles: ProfileCatalog,
  workflowRevision?: MamDesignWorkflowRevision
): void {
  const issues = validateMamDesignProposal({
    roles: proposal.roles,
    workflow: proposal.workflow,
    profiles,
    ...(workflowRevision ? { workflowRevision } : {})
  })
  const errors = issues.filter((issue) => issue.severity === 'error')
  if (errors.length > 0) {
    throw new MamDesignProposalWriterError(
      'design_proposal_invalid',
      errors.map((issue) => issue.message).join('; ')
    )
  }
  const staged: StagedDefinition[] = []
  try {
    for (const role of proposal.roles) {
      profiles.roles.save(role, false)
      staged.push({ id: role.id, version: role.version, registry: profiles.roles })
    }
    profiles.workflows.save(proposal.workflow, false)
    staged.push({
      id: proposal.workflow.id,
      version: proposal.workflow.version,
      registry: profiles.workflows,
      ...(workflowRevision ? { previousVersion: workflowRevision.baseVersion } : {})
    })
    for (const item of staged) item.registry.activate(item.id, item.version)
  } catch (cause) {
    rollback(staged)
    throw cause
  }
}

function rollback(staged: readonly StagedDefinition[]): void {
  const failures: string[] = []
  for (const item of [...staged].reverse()) {
    try {
      item.registry.deactivate(item.id)
      item.registry.discardInactive(item.id, item.version)
      if (item.previousVersion) item.registry.activate(item.id, item.previousVersion)
    } catch (cause) {
      failures.push(cause instanceof Error ? cause.message : String(cause))
    }
  }
  if (failures.length > 0) {
    throw new MamDesignProposalWriterError('design_proposal_rollback_failed', failures.join('; '))
  }
}
