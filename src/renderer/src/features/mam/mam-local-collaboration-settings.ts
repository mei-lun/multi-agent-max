import type { MamLocalSettings } from '../../../../shared/mam/local-settings'
import type { MamUiRunSnapshot } from '../../../../shared/mam/ui-projection'

export function activateMamLocalCollaboration(input: {
  settings: MamLocalSettings
  run: MamUiRunSnapshot
  replaceRunId?: string
}): MamLocalSettings {
  const runRoleIds = input.run.run.roleCatalog.map((entry) => entry.roleProfileId)
  const activeRunIds = (input.settings.automaticWorkflowRunIds ?? []).filter(
    (runId) => runId !== input.replaceRunId
  )
  return {
    ...input.settings,
    participatingRoleProfileIds: [
      ...new Set([...(input.settings.participatingRoleProfileIds ?? []), ...runRoleIds])
    ],
    automaticWorkflowRunIds: [...new Set([...activeRunIds, input.run.run.id])]
  }
}
