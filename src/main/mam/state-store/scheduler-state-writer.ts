import type { KernelEventBatch } from '../scheduler/kernel'

export type SchedulerAppendResult = {
  revision: string
  appendedEventIds: string[]
}

export type SchedulerStateWriter = {
  append(
    workflowRunId: string,
    batch: KernelEventBatch,
    expectedRevision: string
  ): Promise<SchedulerAppendResult>
}
