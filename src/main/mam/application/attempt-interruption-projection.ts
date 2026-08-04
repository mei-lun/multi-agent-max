import type { DiagnosticEvent } from '../diagnostics/diagnostics-recorder'
import type { AttemptProjection } from '../state-store/git-state-projection'
import type { MamUiRunSnapshot } from '../../../shared/mam/ui-projection'

type AttemptInterruption = NonNullable<MamUiRunSnapshot['attempts'][number]['interruption']>
export type AttemptInterruptionIndex = ReadonlyMap<string, DiagnosticEvent>

export function indexAttemptInterruptions(
  diagnostics: readonly DiagnosticEvent[]
): AttemptInterruptionIndex {
  const interruptions = new Map<string, DiagnosticEvent>()
  for (const event of diagnostics) {
    if (event.kind === 'executor' && event.payload.status === 'execution_interrupted') {
      interruptions.set(interruptionKey(event.workflowRunId, event.executorInvocationId), event)
    }
  }
  return interruptions
}

export function projectAttemptInterruption(
  workflowRunId: string,
  attempt: AttemptProjection,
  interruptions: AttemptInterruptionIndex
): AttemptInterruption | undefined {
  if (!attempt.executorInvocationId) return undefined
  const event = interruptions.get(interruptionKey(workflowRunId, attempt.executorInvocationId))
  if (!event) return undefined
  const code = stringValue(event.payload.errorCode) ?? 'execution_error'
  const detail = diagnosticDetail(stringValue(event.payload.message))
  return {
    stage: interruptionStage(code),
    code,
    ...(detail ? { detail } : {}),
    ...interruptionCopy(code, stringValue(event.payload.message)),
    worktreeRetained: event.payload.worktreeRetained === true
  }
}

function interruptionStage(code: string): AttemptInterruption['stage'] {
  if (code.startsWith('structured_result_') || code === 'automatic_review_output_invalid') {
    return 'result_validation'
  }
  if (code.includes('artifact')) return 'artifact_validation'
  return 'executor'
}

function interruptionCopy(
  code: string,
  message: string | undefined
): Pick<AttemptInterruption, 'summary' | 'nextStep'> {
  if (code === 'structured_result_invalid' && message?.includes('not JSON')) {
    return {
      summary: 'The Role finished, but MAM could not accept a complete result.',
      nextStep: 'Choose Retry this Task. MAM will create a fresh Attempt and keep the old record.'
    }
  }
  if (code.startsWith('structured_result_') || code === 'automatic_review_output_invalid') {
    return {
      summary: 'The Role finished, but MAM could not accept a complete result.',
      nextStep: 'Choose Retry this Task. You do not need to edit the internal result format.'
    }
  }
  if (code.includes('artifact')) {
    return {
      summary: 'The Role finished, but MAM could not assemble all required work into the result.',
      nextStep: 'Choose Retry this Task. You do not need to define or repair Artifact contracts.'
    }
  }
  return {
    summary: 'The Role stopped before MAM received a complete result.',
    nextStep:
      'Confirm whether the Role changed anything outside its isolated workspace. Retry only when that external state is safe.'
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function diagnosticDetail(message: string | undefined): string | undefined {
  const compact = message?.replace(/\s+/g, ' ').trim()
  return compact ? compact.slice(0, 500) : undefined
}

function interruptionKey(workflowRunId: string, executorInvocationId: string): string {
  return `${workflowRunId}:${executorInvocationId}`
}
