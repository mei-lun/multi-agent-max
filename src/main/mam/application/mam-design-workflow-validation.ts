import type { MamDesignValidationIssue } from '../../../shared/mam/design-assistant'
import type { WorkflowDefinition } from '../../../shared/mam/domain/workflow'
import { validateMamDesignDelivery } from './mam-design-delivery-validation'
import { validateMamDesignHandoffs } from './mam-design-handoff-validation'
import { validateMamDesignMergeCommands } from './mam-design-merge-validation'

export function validateMamDesignWorkflow(
  workflow: WorkflowDefinition
): MamDesignValidationIssue[] {
  return [
    ...validateMamDesignMergeCommands(workflow),
    ...validateMamDesignHandoffs(workflow),
    ...validateMamDesignDelivery(workflow)
  ]
}
