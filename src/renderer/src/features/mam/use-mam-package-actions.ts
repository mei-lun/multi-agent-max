import { useCallback } from 'react'
import type { MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import type { MamExportWorkflowPackageInput } from '../../../../shared/mam/workflow-package'
import { getMamRendererApi } from '../../renderer-api'

export function useMamPackageActions(
  applyAuthoritativeChange: (operation: () => Promise<unknown>) => Promise<void>
): Readonly<{
  importWorkflowPackage(): Promise<void>
  importSkill(): Promise<void>
  exportWorkflowPackage(input: MamExportWorkflowPackageInput): Promise<string | undefined>
}> {
  const importWorkflowPackage = useCallback(
    () =>
      applyAuthoritativeChange(() =>
        importWithSnapshot(() => getMamRendererApi().importWorkflowPackage())
      ),
    [applyAuthoritativeChange]
  )
  const importSkill = useCallback(
    () =>
      applyAuthoritativeChange(() => importWithSnapshot(() => getMamRendererApi().importSkill())),
    [applyAuthoritativeChange]
  )
  const exportWorkflowPackage = useCallback(
    (input: MamExportWorkflowPackageInput) => getMamRendererApi().exportWorkflowPackage(input),
    []
  )
  return { importWorkflowPackage, importSkill, exportWorkflowPackage }
}

async function importWithSnapshot(
  operation: () => Promise<MamUiSnapshot | undefined>
): Promise<MamUiSnapshot> {
  const result = await operation()
  return result ?? getMamRendererApi().getUiSnapshot()
}
