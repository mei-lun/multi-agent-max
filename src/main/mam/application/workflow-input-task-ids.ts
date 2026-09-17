import type { WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'

export function workflowInputTaskIds(
  bundle: WorkflowRunBundle,
  nodeId: string
): readonly string[] {
  const byNode = new Map(bundle.taskCatalog.map((task) => [task.nodeId, task.id]))
  const dependencies = new Map(
    bundle.plan.nodes.map((node) => [node.id, node.dependencies] as const)
  )
  const found = new Set<string>()
  const visited = new Set<string>()
  const visit = (candidateNodeId: string): void => {
    if (visited.has(candidateNodeId)) return
    visited.add(candidateNodeId)
    const taskId = byNode.get(candidateNodeId)
    if (taskId) {
      found.add(taskId)
      return
    }
    for (const dependency of dependencies.get(candidateNodeId) ?? []) visit(dependency)
  }
  for (const dependency of dependencies.get(nodeId) ?? []) visit(dependency)
  return [...found].sort()
}
