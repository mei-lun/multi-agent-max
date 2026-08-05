import type { MamDesignValidationIssue } from '../../../shared/mam/design-assistant'
import type { WorkflowDefinition } from '../../../shared/mam/domain/workflow'
import { isExecutableMergeValidationCommand } from './merge-validation-policy'

export function validateMamDesignMergeCommands(
  workflow: WorkflowDefinition
): MamDesignValidationIssue[] {
  return workflow.nodes.flatMap((node) => {
    if (node.type !== 'git_merge') return []
    return node.validations.flatMap((command, index) =>
      isExecutableMergeValidationCommand(command)
        ? []
        : [
            {
              code: 'merge_validation_command_required',
              severity: 'error' as const,
              message: `Merge validation must be an executable command, not a prose checklist: ${command}`,
              path: `workflow.nodes.${node.id}.validations.${index}`
            }
          ]
    )
  })
}
