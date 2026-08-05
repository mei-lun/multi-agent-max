import { useEffect, useRef, useState } from 'react'
import type { MamLocalSettings } from '../../../../shared/mam/local-settings'
import type { MamSnapshotState } from './mam-snapshot-state'
import {
  activeLocalCollaborationRunIds,
  nextMamLocalMergeRunId,
  nextMamLocalCollaborationAction
} from './mam-local-collaboration-plan'

export function useMamLocalCollaboration(state: MamSnapshotState): ReadonlyMap<string, string> {
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map())
  const advancing = useRef(false)
  const failedActions = useRef(new Map<string, string>())
  const {
    snapshot,
    pending,
    assignTask,
    recoverAttempt,
    startAttempt,
    executeNextMerge,
    saveLocalSettings
  } = state
  useEffect(() => {
    if (!snapshot || pending || advancing.current) return
    const activeRunIds = activeLocalCollaborationRunIds(snapshot)
    for (const workflowRunId of failedActions.current.keys()) {
      if (!activeRunIds.includes(workflowRunId)) failedActions.current.delete(workflowRunId)
    }
    const participatingRoleIds = snapshot.localSettings.participatingRoleProfileIds ?? []
    if (activeRunIds.length === 0 || participatingRoleIds.length === 0) return
    const nextMergeRunId = nextMamLocalMergeRunId(snapshot, activeRunIds, participatingRoleIds)
    const advance = async (): Promise<void> => {
      advancing.current = true
      let currentRunId: string | undefined
      try {
        for (const workflowRunId of activeRunIds) {
          currentRunId = workflowRunId
          const run = snapshot.runs.find((candidate) => candidate.run.id === workflowRunId)
          if (!run) continue
          const action = nextMamLocalCollaborationAction(run, participatingRoleIds)
          const actionKey = localActionKey(action, run.run.updatedAt, snapshot.localSettings)
          if (failedActions.current.get(workflowRunId) === actionKey) continue
          if (action.kind === 'assign') {
            await assignTask(action.input)
            failedActions.current.delete(workflowRunId)
            clearRunError(setErrors, workflowRunId)
            return
          }
          if (action.kind === 'start') {
            await startAttempt(action.input)
            failedActions.current.delete(workflowRunId)
            clearRunError(setErrors, workflowRunId)
            return
          }
          if (action.kind === 'recover') {
            await recoverAttempt(action.input)
            failedActions.current.delete(workflowRunId)
            clearRunError(setErrors, workflowRunId)
            return
          }
          if (action.kind === 'merge') {
            if (workflowRunId !== nextMergeRunId) continue
            await executeNextMerge(action.input)
            failedActions.current.delete(workflowRunId)
            clearRunError(setErrors, workflowRunId)
            return
          }
          if (action.reason === 'complete') {
            await saveLocalSettings({
              settings: {
                ...snapshot.localSettings,
                automaticWorkflowRunIds: activeRunIds.filter((id) => id !== workflowRunId)
              }
            })
            clearRunError(setErrors, workflowRunId)
            return
          }
        }
      } catch (cause) {
        if (currentRunId) {
          const run = snapshot.runs.find((candidate) => candidate.run.id === currentRunId)
          if (run) {
            failedActions.current.set(
              currentRunId,
              localActionKey(
                nextMamLocalCollaborationAction(run, participatingRoleIds),
                run.run.updatedAt,
                snapshot.localSettings
              )
            )
          }
          setErrors((current) => {
            const next = new Map(current)
            next.set(currentRunId!, cause instanceof Error ? cause.message : String(cause))
            return next
          })
        }
      } finally {
        advancing.current = false
      }
    }
    void advance()
  }, [
    assignTask,
    executeNextMerge,
    pending,
    recoverAttempt,
    saveLocalSettings,
    snapshot,
    startAttempt
  ])
  return errors
}

function localActionKey(
  action: ReturnType<typeof nextMamLocalCollaborationAction>,
  runUpdatedAt: string,
  settings: MamLocalSettings
): string {
  return JSON.stringify([action, runUpdatedAt, settings])
}

function clearRunError(
  setErrors: React.Dispatch<React.SetStateAction<ReadonlyMap<string, string>>>,
  workflowRunId: string
): void {
  setErrors((current) => {
    if (!current.has(workflowRunId)) return current
    const next = new Map(current)
    next.delete(workflowRunId)
    return next
  })
}
