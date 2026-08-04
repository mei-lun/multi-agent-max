import type { ProfileCatalog } from '../profiles/profile-catalog'
import type { MamDesignProposal } from '../../../shared/mam/design-assistant'
import type { MamDesignProposalSpec } from '../../../shared/mam/design-proposal'
import { failMamDesignAssistant } from './mam-design-assistant-error'
import { materializeMamDesignProposal } from './mam-design-proposal-materializer'
import { createMamDesignProposalIdAllocator } from './mam-design-proposal-id-allocator'
import { createMamDesignProposal } from './mam-design-proposal-validation'
import {
  createMamDesignStandardTemplate,
  MamDesignStandardTemplateError
} from './mam-design-standard-template'

export function buildMamDesignStandardTemplate(input: {
  profiles: ProfileCatalog
  modelProfileId: string
}): MamDesignProposalSpec {
  try {
    return createMamDesignStandardTemplate(input)
  } catch (cause) {
    if (cause instanceof MamDesignStandardTemplateError) {
      failMamDesignAssistant(cause.code, cause.message)
    }
    throw cause
  }
}

export function buildMamDesignProposal(input: {
  source: MamDesignProposalSpec
  template: MamDesignProposalSpec
  profiles: ProfileCatalog
  now: () => string
}): MamDesignProposal {
  const role = input.template.roles[0]
  if (!role?.executorProfileId || !role.modelProfileId) {
    failMamDesignAssistant(
      'design_template_invalid',
      'Standard template must include an Executor and Model Profile'
    )
  }
  const materialized = materializeMamDesignProposal(
    input.source,
    createMamDesignProposalIdAllocator(input.profiles),
    {
      executorProfileId: role.executorProfileId,
      modelProfileId: role.modelProfileId
    }
  )
  return createMamDesignProposal({
    ...materialized,
    profiles: input.profiles,
    now: input.now,
    source: input.source
  })
}
