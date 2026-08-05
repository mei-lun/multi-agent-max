import type { MamDesignDraft } from '../../../shared/mam/design-assistant'
import type { ProfileCatalog } from '../profiles/profile-catalog'
import type { MamDesignDraftStore } from './mam-design-draft-store'
import {
  createMamDesignIssueRecovery,
  hasBlockingDesignIssues
} from './mam-design-generation-recovery'
import { createMamDesignProposal } from './mam-design-proposal-validation'

export function refreshMamDesignProposal(input: {
  draft: MamDesignDraft
  profiles: ProfileCatalog
  drafts: MamDesignDraftStore
  now: () => string
}): MamDesignDraft {
  const current = input.draft.proposal
  if (!current || input.draft.status === 'applied') return input.draft
  const proposal = createMamDesignProposal({
    roles: current.roles,
    workflow: current.workflow,
    profiles: input.profiles,
    now: () => current.createdAt,
    ...(current.source ? { source: current.source } : {}),
    ...(input.draft.workflowRevision ? { workflowRevision: input.draft.workflowRevision } : {})
  })
  const recovery = hasBlockingDesignIssues(proposal.issues)
    ? (input.draft.recovery ?? invalidProposalRecovery(proposal.issues, input.now()))
    : input.draft.recovery
  if (
    JSON.stringify(proposal.issues) === JSON.stringify(current.issues) &&
    JSON.stringify(recovery) === JSON.stringify(input.draft.recovery)
  ) {
    return input.draft
  }
  const { recovery: _recovery, ...rest } = input.draft
  return input.drafts.save({
    ...rest,
    proposal,
    ...(recovery ? { recovery } : {}),
    updatedAt: input.now()
  })
}

function invalidProposalRecovery(
  issues: NonNullable<MamDesignDraft['proposal']>['issues'],
  occurredAt: string
) {
  return createMamDesignIssueRecovery(issues, occurredAt)
}
