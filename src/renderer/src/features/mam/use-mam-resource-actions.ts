import { useCallback } from 'react'
import {
  CodexResourceCandidateSchema,
  type MamImportCodexResourcesInput
} from '../../../../shared/mam/resource-import'
import { MamUiSnapshotSchema, type MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import { getMamRendererApi } from '../../renderer-api'

export function useMamResourceActions(onSnapshot: (snapshot: MamUiSnapshot) => void) {
  const listCodexResources = useCallback(async () => {
    return CodexResourceCandidateSchema.array().parse(
      await getMamRendererApi().listCodexResources()
    )
  }, [])
  const importCodexResources = useCallback(
    async (input: MamImportCodexResourcesInput) => {
      onSnapshot(
        MamUiSnapshotSchema.parse(await getMamRendererApi().importCodexResources(input))
      )
    },
    [onSnapshot]
  )
  const checkResourceHealth = useCallback(async () => {
    onSnapshot(MamUiSnapshotSchema.parse(await getMamRendererApi().checkResourceHealth()))
  }, [onSnapshot])
  return { listCodexResources, importCodexResources, checkResourceHealth }
}
