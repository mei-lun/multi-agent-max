import { useCallback } from 'react'
import type {
  MamDeleteRoleProfileInput,
  MamDeleteWorkflowInput
} from '../../../../shared/mam/application-command'
import { getMamRendererApi } from '../../renderer-api'

type ApplyChange = (
  operation: () => Promise<unknown>,
  options?: Readonly<{ rethrow?: boolean; surface?: boolean }>
) => Promise<void>

export function useMamDeletionActions(applyChange: ApplyChange) {
  const options = { rethrow: true, surface: false } as const
  const deleteRoleProfile = useCallback(
    (input: MamDeleteRoleProfileInput) =>
      applyChange(() => getMamRendererApi().deleteRoleProfile(input), options),
    [applyChange]
  )
  const deleteWorkflow = useCallback(
    (input: MamDeleteWorkflowInput) =>
      applyChange(() => getMamRendererApi().deleteWorkflow(input), options),
    [applyChange]
  )
  return { deleteRoleProfile, deleteWorkflow }
}
