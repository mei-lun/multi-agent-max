import { EMPTY_SCHEDULER_REVISION } from '../../../shared/mam/scheduler-protocol'
import type { WorkflowRunProjection } from './git-state-projection'
import { withProjectionHash } from './git-state-stable-hash'

export function emptyWorkflowRunProjection(workflowRunId: string): WorkflowRunProjection {
  return withProjectionHash({
    schemaVersion: '1.0.0',
    workflowRunId,
    revision: EMPTY_SCHEDULER_REVISION,
    stateHash: '',
    eventIds: [],
    commandIds: [],
    tasks: {},
    attempts: {},
    dynamicTaskPlans: {},
    dynamicTasks: {},
    reviews: {},
    reviewAggregations: {},
    reviewPanels: {},
    reviewTasks: {},
    reviewValidity: {},
    mergeQueueEntries: {},
    mergeConflictTasks: {},
    mergeConflictResolutions: {},
    resolvedApprovalGates: {},
    resolvedConditions: {},
    systemNodeExecutions: {},
    reusedNodeCompletions: {},
    conflictResolutions: {},
    lastEventAt: '1970-01-01T00:00:00.000Z'
  })
}
