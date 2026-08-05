import type { MamExportExecutionActivityInput } from '../../../shared/mam/execution-activity-export'
import type { DiagnosticEvent } from './diagnostics-recorder'

export function selectExecutionActivityEvents(
  events: readonly DiagnosticEvent[],
  scope: MamExportExecutionActivityInput
): DiagnosticEvent[] {
  return events.filter(
    (event) =>
      event.workflowRunId === scope.workflowRunId &&
      (!scope.nodeId || event.nodeId === scope.nodeId)
  )
}
