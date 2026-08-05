import type { MamDesignDraft } from '../../../shared/mam/design-assistant'
import type { MamUiSnapshot } from '../../../shared/mam/ui-projection'
import type { ProfileCatalog } from '../profiles/profile-catalog'
import { failMamDesignAssistant } from './mam-design-assistant-error'
import type { MamDesignDraftStore } from './mam-design-draft-store'
import { createMamDesignRecovery, hasBlockingDesignIssues } from './mam-design-generation-recovery'
import type { MamUiQueryService } from './mam-ui-query-service'
import { writeMamDesignProposal } from './mam-design-proposal-writer'

export function applyMamDesignProposal(input: {
  draft: MamDesignDraft
  proposalHash: string
  profiles: ProfileCatalog
  drafts: MamDesignDraftStore
  query: MamUiQueryService
  now: () => string
}): MamUiSnapshot {
  const proposal = input.draft.proposal
  if (!proposal || proposal.hash !== input.proposalHash) {
    failMamDesignAssistant('design_proposal_stale', 'Confirm the current Design proposal revision')
  }
  if (hasBlockingDesignIssues(proposal.issues)) {
    failMamDesignAssistant(
      'design_proposal_invalid',
      'Resolve proposal errors before creating definitions'
    )
  }
  try {
    writeMamDesignProposal(proposal, input.profiles, input.draft.workflowRevision)
  } catch (cause) {
    input.drafts.save({
      ...input.draft,
      recovery: createMamDesignRecovery(cause, input.now()),
      updatedAt: input.now()
    })
    throw cause
  }
  input.drafts.save({
    ...input.draft,
    status: 'applied',
    appliedAt: input.now(),
    updatedAt: input.now()
  })
  return input.query.getSnapshot()
}
