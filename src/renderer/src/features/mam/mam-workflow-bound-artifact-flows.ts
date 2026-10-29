import type { WorkflowDefinition } from '../../../../shared/mam/domain/workflow'
import type { MamUiRunSnapshot } from '../../../../shared/mam/ui-projection'
import { analyzeWorkflowVisual } from './mam-workflow-visual-analysis'
import { reachableWorkflowNodes } from './mam-workflow-reachability'

export type BoundArtifactFlow = Readonly<{
  id: string
  artifactId: string
  producerNodeId?: string
  consumerNodeId: string
  status: 'bound' | 'unresolved' | 'external'
  sourceAttemptId?: string
  targetTaskId: string
  contentHash: string
}>

export function boundArtifactFlows(
  run: MamUiRunSnapshot,
  definition: WorkflowDefinition
): BoundArtifactFlow[] {
  const nodeByRun = new Map(run.nodeRuns.map((node) => [node.id, node.nodeId]))
  const currentDeliveries = new Set(
    run.tasks.flatMap((task) =>
      task.currentDeliveryAttemptId ? [task.currentDeliveryAttemptId] : []
    )
  )
  const claimTypes = new Map(
    run.tasks.map((task) => [
      task.id,
      new Set((task.outputContracts ?? []).map((contract) => contract.artifactType))
    ])
  )
  const producerClaims = run.attempts.flatMap((attempt) => {
    if (!currentDeliveries.has(attempt.id)) return []
    if (attempt.status !== 'submitted' || attempt.result?.status !== 'submitted') return []
    if (attempt.result.system.workflowRunId !== run.run.id) return []
    const nodeId = nodeByRun.get(attempt.result.system.nodeRunId)
    if (!nodeId) return []
    return attempt.result.artifacts
      .filter(
        (claim) =>
          claim.type === claim.contractId && claimTypes.get(attempt.taskId)?.has(claim.contractId)
      )
      .map((claim) => ({
        nodeId,
        attemptId: attempt.id,
        artifactId: claim.contractId,
        contentHash: claim.sha256
      }))
  })
  const ids = new Set(definition.nodes.map((node) => node.id))
  const baseEdges = [...analyzeWorkflowVisual(definition).baseOutgoing].flatMap(([from, targets]) =>
    targets.map((to) => ({ from, to }))
  )
  return run.tasks.flatMap((task) => {
    const nodeId = task.nodeId
    if (!nodeId || !ids.has(nodeId)) return []
    return (task.inputArtifacts ?? []).map((input, index) => {
      const matches = producerClaims.filter(
        (claim) =>
          claim.artifactId === input.artifactId &&
          claim.contentHash === input.contentHash &&
          claim.nodeId !== nodeId &&
          reachableWorkflowNodes(claim.nodeId, baseEdges, 'downstream').has(nodeId)
      )
      const status = matches.length === 1 ? 'bound' : matches.length > 1 ? 'unresolved' : 'external'
      return {
        id: `bound:${task.id}:${input.artifactId}:${index}`,
        artifactId: input.artifactId,
        consumerNodeId: nodeId,
        targetTaskId: task.id,
        contentHash: input.contentHash,
        status,
        ...(status === 'bound'
          ? { producerNodeId: matches[0]!.nodeId, sourceAttemptId: matches[0]!.attemptId }
          : {})
      }
    })
  })
}
