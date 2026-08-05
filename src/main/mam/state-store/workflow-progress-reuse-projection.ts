export type ReusedTaskResultSource = Readonly<{
  workflowRunId: string
  taskId: string
  attemptId: string
  nodeId: string
}>

export type ReusedNodeCompletions = Readonly<
  Record<
    string,
    Readonly<{
      sourceWorkflowRunId: string
      sourceNodeId: string
      sourceEvidenceId: string
      reusedAt: string
    }>
  >
>
