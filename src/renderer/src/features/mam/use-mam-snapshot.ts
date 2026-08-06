import { useCallback, useEffect, useRef, useState } from 'react'
import { MamUiSnapshotSchema, type MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import type {
  MamAssignTaskInput,
  MamCancelWorkflowRunInput,
  MamReassignTaskInput,
  MamCreateWorkflowRunInput,
  MamRecoverAttemptInput,
  MamRestartWorkflowRunInput,
  MamResolveReviewDisagreementInput,
  MamResolveApprovalGateInput,
  MamSaveLocalSettingsInput,
  MamSaveModelConnectionInput,
  MamSaveProfileInput,
  MamSelectAttemptInput,
  MamSubmitReviewInput,
  MamSaveWorkflowInput,
  MamStartAttemptInput,
  MamExecuteNextMergeInput
} from '../../../../shared/mam/application-command'
import { getMamRendererApi } from '../../renderer-api'
import {
  MamAttemptDiffSchema,
  type MamGetAttemptDiffInput
} from '../../../../shared/mam/attempt-inspection'
import type { MamFetchModelCatalogInput } from '../../../../shared/mam/model-catalog'
import { useMamPackageActions } from './use-mam-package-actions'
import { useMamDeletionActions } from './use-mam-deletion-actions'
import { mamApplicationErrorMessage } from './mam-application-error-message'
import type { MamSnapshotState } from './mam-snapshot-state'
import { useMamHumanAttentionActions } from './use-mam-human-attention-actions'

export function useMamSnapshot(): MamSnapshotState {
  const [snapshot, setSnapshot] = useState<MamUiSnapshot>()
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(true)
  const [showPending, setShowPending] = useState(false)
  const mounted = useRef(true)
  const refresh = useCallback(async () => {
    setPending(true)
    setError(undefined)
    const timer = window.setTimeout(() => setShowPending(true), 200)
    try {
      const next = MamUiSnapshotSchema.parse(await getMamRendererApi().getUiSnapshot())
      if (mounted.current) setSnapshot(next)
    } catch (cause) {
      if (mounted.current) setError(mamApplicationErrorMessage(cause))
    } finally {
      window.clearTimeout(timer)
      if (mounted.current) {
        setPending(false)
        setShowPending(false)
      }
    }
  }, [])
  const selectProject = useCallback(async () => {
    setPending(true)
    setError(undefined)
    const timer = window.setTimeout(() => setShowPending(true), 200)
    try {
      const result = await getMamRendererApi().selectProject()
      if (result && mounted.current) setSnapshot(MamUiSnapshotSchema.parse(result))
    } catch (cause) {
      if (mounted.current) setError(mamApplicationErrorMessage(cause))
    } finally {
      window.clearTimeout(timer)
      if (mounted.current) {
        setPending(false)
        setShowPending(false)
      }
    }
  }, [])
  const applyAuthoritativeChange = useCallback(
    async (
      operation: () => Promise<unknown>,
      options: Readonly<{ rethrow?: boolean; surface?: boolean }> = {}
    ) => {
      setPending(true)
      setError(undefined)
      const timer = window.setTimeout(() => setShowPending(true), 200)
      try {
        const next = MamUiSnapshotSchema.parse(await operation())
        if (mounted.current) setSnapshot(next)
      } catch (cause) {
        const normalized = new Error(mamApplicationErrorMessage(cause))
        if (mounted.current && options.surface !== false) setError(normalized.message)
        if (options.rethrow) throw normalized
      } finally {
        window.clearTimeout(timer)
        if (mounted.current) {
          setPending(false)
          setShowPending(false)
        }
      }
    },
    []
  )
  const assignTask = useCallback(
    (input: MamAssignTaskInput) =>
      applyAuthoritativeChange(() => getMamRendererApi().assignTask(input), {
        rethrow: true,
        surface: false
      }),
    [applyAuthoritativeChange]
  )
  const reassignTask = useCallback(
    (input: MamReassignTaskInput) =>
      applyAuthoritativeChange(() => getMamRendererApi().reassignTask(input), {
        rethrow: true,
        surface: false
      }),
    [applyAuthoritativeChange]
  )
  const recoverAttempt = useCallback(
    (input: MamRecoverAttemptInput) =>
      applyAuthoritativeChange(() => getMamRendererApi().recoverAttempt(input), {
        rethrow: true,
        surface: false
      }),
    [applyAuthoritativeChange]
  )
  const startAttempt = useCallback(
    (input: MamStartAttemptInput) =>
      applyAuthoritativeChange(() => getMamRendererApi().startAttempt(input), {
        rethrow: true,
        surface: false
      }),
    [applyAuthoritativeChange]
  )
  const executeNextMerge = useCallback(
    (input: MamExecuteNextMergeInput) =>
      applyAuthoritativeChange(() => getMamRendererApi().executeNextMerge(input), {
        rethrow: true,
        surface: false
      }),
    [applyAuthoritativeChange]
  )
  const saveWorkflow = useCallback(async (input: MamSaveWorkflowInput) => {
    setPending(true)
    setError(undefined)
    const timer = window.setTimeout(() => setShowPending(true), 200)
    try {
      const next = MamUiSnapshotSchema.parse(await getMamRendererApi().saveWorkflow(input))
      if (mounted.current) setSnapshot(next)
    } catch (cause) {
      const normalized = new Error(mamApplicationErrorMessage(cause))
      if (mounted.current) setError(normalized.message)
      throw normalized
    } finally {
      window.clearTimeout(timer)
      if (mounted.current) {
        setPending(false)
        setShowPending(false)
      }
    }
  }, [])
  const submitReview = useCallback(
    (input: MamSubmitReviewInput) =>
      applyAuthoritativeChange(() => getMamRendererApi().submitReview(input)),
    [applyAuthoritativeChange]
  )
  const applyAndReturnAuthoritativeChange = useCallback(
    async (operation: () => Promise<unknown>) => {
      setPending(true)
      setError(undefined)
      try {
        const next = MamUiSnapshotSchema.parse(await operation())
        if (mounted.current) setSnapshot(next)
        return next
      } catch (cause) {
        const normalized = new Error(mamApplicationErrorMessage(cause))
        if (mounted.current) setError(normalized.message)
        throw normalized
      } finally {
        if (mounted.current) setPending(false)
      }
    },
    []
  )
  const createWorkflowRun = useCallback(
    (input: MamCreateWorkflowRunInput) =>
      applyAndReturnAuthoritativeChange(() => getMamRendererApi().createWorkflowRun(input)),
    [applyAndReturnAuthoritativeChange]
  )
  const cancelWorkflowRun = useCallback(
    (input: MamCancelWorkflowRunInput) =>
      applyAuthoritativeChange(() => getMamRendererApi().cancelWorkflowRun(input), {
        rethrow: true,
        surface: false
      }),
    [applyAuthoritativeChange]
  )
  const restartWorkflowRun = useCallback(
    (input: MamRestartWorkflowRunInput) =>
      applyAndReturnAuthoritativeChange(() => getMamRendererApi().restartWorkflowRun(input)),
    [applyAndReturnAuthoritativeChange]
  )
  const resolveReviewDisagreement = useCallback(
    (input: MamResolveReviewDisagreementInput) =>
      applyAuthoritativeChange(() => getMamRendererApi().resolveReviewDisagreement(input)),
    [applyAuthoritativeChange]
  )
  const resolveApprovalGate = useCallback(
    (input: MamResolveApprovalGateInput) =>
      applyAuthoritativeChange(() => getMamRendererApi().resolveApprovalGate(input)),
    [applyAuthoritativeChange]
  )
  const humanAttentionActions = useMamHumanAttentionActions(applyAuthoritativeChange)
  const selectAttempt = useCallback(
    (input: MamSelectAttemptInput) =>
      applyAuthoritativeChange(() => getMamRendererApi().selectAttempt(input)),
    [applyAuthoritativeChange]
  )
  const saveProfile = useCallback(
    (input: MamSaveProfileInput) =>
      applyAuthoritativeChange(() => getMamRendererApi().saveProfile(input)),
    [applyAuthoritativeChange]
  )
  const saveLocalSettings = useCallback(
    (input: MamSaveLocalSettingsInput) =>
      applyAuthoritativeChange(() => getMamRendererApi().saveLocalSettings(input), {
        rethrow: true,
        surface: false
      }),
    [applyAuthoritativeChange]
  )
  const saveModelConnection = useCallback(async (input: MamSaveModelConnectionInput) => {
    setPending(true)
    setError(undefined)
    try {
      const next = MamUiSnapshotSchema.parse(await getMamRendererApi().saveModelConnection(input))
      if (mounted.current) setSnapshot(next)
    } catch (cause) {
      const normalized = new Error(mamApplicationErrorMessage(cause))
      if (mounted.current) setError(normalized.message)
      throw normalized
    } finally {
      if (mounted.current) setPending(false)
    }
  }, [])
  const fetchModelCatalog = useCallback(
    (input: MamFetchModelCatalogInput) => getMamRendererApi().fetchModelCatalog(input),
    []
  )
  const { deleteRoleProfile, deleteWorkflow } = useMamDeletionActions(applyAuthoritativeChange)
  const { importSkill, importWorkflowPackage, exportWorkflowPackage } =
    useMamPackageActions(applyAuthoritativeChange)
  const exportDiagnostics = useCallback(() => getMamRendererApi().exportDiagnostics(), [])
  const exportExecutionActivity = useCallback(getMamRendererApi().exportExecutionActivity, [])
  const getAttemptDiff = useCallback(async (input: MamGetAttemptDiffInput) => {
    return MamAttemptDiffSchema.parse(await getMamRendererApi().getAttemptDiff(input))
  }, [])
  useEffect(() => {
    mounted.current = true
    void refresh()
    const unsubscribe = getMamRendererApi().onUiSnapshotChanged(() => void refresh())
    return () => {
      mounted.current = false
      unsubscribe()
    }
  }, [refresh])
  return {
    ...(snapshot ? { snapshot } : {}),
    ...(error ? { error } : {}),
    pending,
    showPending,
    refresh,
    selectProject,
    assignTask,
    reassignTask,
    recoverAttempt,
    startAttempt,
    executeNextMerge,
    saveWorkflow,
    createWorkflowRun,
    cancelWorkflowRun,
    restartWorkflowRun,
    submitReview,
    resolveReviewDisagreement,
    resolveApprovalGate,
    ...humanAttentionActions,
    selectAttempt,
    saveProfile,
    saveLocalSettings,
    saveModelConnection,
    fetchModelCatalog,
    deleteRoleProfile,
    deleteWorkflow,
    importSkill,
    importWorkflowPackage,
    exportWorkflowPackage,
    exportDiagnostics,
    exportExecutionActivity,
    getAttemptDiff
  }
}
