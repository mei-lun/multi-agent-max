import { useCallback, useEffect, useRef, useState } from 'react'
import { MamUiSnapshotSchema, type MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import type {
  MamAssignTaskInput,
  MamCreateWorkflowRunInput,
  MamRecoverAttemptInput,
  MamResolveReviewDisagreementInput,
  MamResolveApprovalGateInput,
  MamSaveLocalSettingsInput,
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
  type MamAttemptDiff,
  type MamGetAttemptDiffInput
} from '../../../../shared/mam/attempt-inspection'

export type MamSnapshotState = Readonly<{
  snapshot?: MamUiSnapshot
  error?: string
  pending: boolean
  showPending: boolean
  refresh(): Promise<void>
  selectProject(): Promise<void>
  assignTask(input: MamAssignTaskInput): Promise<void>
  recoverAttempt(input: MamRecoverAttemptInput): Promise<void>
  startAttempt(input: MamStartAttemptInput): Promise<void>
  executeNextMerge(input: MamExecuteNextMergeInput): Promise<void>
  saveWorkflow(input: MamSaveWorkflowInput): Promise<void>
  createWorkflowRun(input: MamCreateWorkflowRunInput): Promise<void>
  submitReview(input: MamSubmitReviewInput): Promise<void>
  resolveReviewDisagreement(input: MamResolveReviewDisagreementInput): Promise<void>
  resolveApprovalGate(input: MamResolveApprovalGateInput): Promise<void>
  selectAttempt(input: MamSelectAttemptInput): Promise<void>
  saveProfile(input: MamSaveProfileInput): Promise<void>
  saveLocalSettings(input: MamSaveLocalSettingsInput): Promise<void>
  importSkill(): Promise<void>
  exportDiagnostics(): Promise<string | undefined>
  getAttemptDiff(input: MamGetAttemptDiffInput): Promise<MamAttemptDiff>
}>

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
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
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
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      window.clearTimeout(timer)
      if (mounted.current) {
        setPending(false)
        setShowPending(false)
      }
    }
  }, [])
  const applyAuthoritativeChange = useCallback(async (operation: () => Promise<unknown>) => {
    setPending(true)
    setError(undefined)
    const timer = window.setTimeout(() => setShowPending(true), 200)
    try {
      const next = MamUiSnapshotSchema.parse(await operation())
      if (mounted.current) setSnapshot(next)
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      window.clearTimeout(timer)
      if (mounted.current) {
        setPending(false)
        setShowPending(false)
      }
    }
  }, [])
  const assignTask = useCallback(
    (input: MamAssignTaskInput) =>
      applyAuthoritativeChange(() => getMamRendererApi().assignTask(input)),
    [applyAuthoritativeChange]
  )
  const recoverAttempt = useCallback(
    (input: MamRecoverAttemptInput) =>
      applyAuthoritativeChange(() => getMamRendererApi().recoverAttempt(input)),
    [applyAuthoritativeChange]
  )
  const startAttempt = useCallback(
    (input: MamStartAttemptInput) =>
      applyAuthoritativeChange(() => getMamRendererApi().startAttempt(input)),
    [applyAuthoritativeChange]
  )
  const executeNextMerge = useCallback(
    (input: MamExecuteNextMergeInput) =>
      applyAuthoritativeChange(() => getMamRendererApi().executeNextMerge(input)),
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
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
      throw cause
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
  const createWorkflowRun = useCallback(
    (input: MamCreateWorkflowRunInput) =>
      applyAuthoritativeChange(() => getMamRendererApi().createWorkflowRun(input)),
    [applyAuthoritativeChange]
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
      applyAuthoritativeChange(() => getMamRendererApi().saveLocalSettings(input)),
    [applyAuthoritativeChange]
  )
  const importSkill = useCallback(async () => {
    await applyAuthoritativeChange(async () => {
      const result = await getMamRendererApi().importSkill()
      return result ?? getMamRendererApi().getUiSnapshot()
    })
  }, [applyAuthoritativeChange])
  const exportDiagnostics = useCallback(() => getMamRendererApi().exportDiagnostics(), [])
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
    recoverAttempt,
    startAttempt,
    executeNextMerge,
    saveWorkflow,
    createWorkflowRun,
    submitReview,
    resolveReviewDisagreement,
    resolveApprovalGate,
    selectAttempt,
    saveProfile,
    saveLocalSettings,
    importSkill,
    exportDiagnostics,
    getAttemptDiff
  }
}
