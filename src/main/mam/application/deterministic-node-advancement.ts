import type { GitStateRepository } from '../state-store/git-state-repository'
import { advanceReadyConditions } from './condition-advancement'
import { advanceReadySystemNodes } from './system-node-advancement'

export function advanceDeterministicNodes(input: {
  repository: GitStateRepository
  workflowRunId: string
  schedulerId: string
  nextCommandId(): string
  now(): string
}): Readonly<{ conditions: readonly string[]; systemNodes: readonly string[] }> {
  const conditions: string[] = []
  const systemNodes: string[] = []
  for (;;) {
    const system = advanceReadySystemNodes(input)
    const resolved = advanceReadyConditions(input)
    systemNodes.push(...system)
    conditions.push(...resolved)
    if (system.length === 0 && resolved.length === 0) return { conditions, systemNodes }
  }
}
